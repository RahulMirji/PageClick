/**
 * Action Executor — runs approved ActionSteps on the page.
 *
 * Handles: click, input, scroll, extract, navigate
 * Each action includes wait strategies and result reporting.
 */

import type { ActionStep } from "../shared/messages";

// ── CDP fallback helpers (for canvas-based editors like Google Docs) ──

/** Send text via CDP Input.insertText through the background service worker. */
async function cdpInsertText(text: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "CDP_TYPE", text },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { ok: false, error: "No response from background" });
        }
      },
    );
  });
}

/** Dispatch a key press via CDP Input.dispatchKeyEvent through the background. */
async function cdpDispatchKey(key: string): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(
      { type: "CDP_KEY", key },
      (response) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(response || { ok: false, error: "No response from background" });
        }
      },
    );
  });
}

// ── Types ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  action: string;
  selector: string;
  extractedData?: string;
  error?: string;
  observation?: {
    url: string;
    title: string;
    elementFound: boolean;
    elementVisible: boolean;
    elementTag?: string;
    newUrl?: string;
  };
  durationMs: number;
}

// ── Wait strategies ───────────────────────────────────────────────

function waitForDomStable(timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MutationObserver === "undefined") {
      setTimeout(resolve, 150);
      return;
    }

    let timer: ReturnType<typeof setTimeout>;
    let settled = false;

    const observer = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          observer.disconnect();
          resolve();
        }
      }, 300); // 300ms of no mutations = stable
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    // Initial timer — if nothing mutates at all
    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        observer.disconnect();
        resolve();
      }
    }, 500);

    // Hard timeout
    setTimeout(() => {
      if (!settled) {
        settled = true;
        observer.disconnect();
        resolve();
      }
    }, timeoutMs);
  });
}

function waitForUrlChange(timeoutMs = 5000): Promise<void> {
  return new Promise((resolve) => {
    const originalUrl = window.location.href;
    const interval = setInterval(() => {
      if (window.location.href !== originalUrl) {
        clearInterval(interval);
        resolve();
      }
    }, 100);

    setTimeout(() => {
      clearInterval(interval);
      resolve();
    }, timeoutMs);
  });
}

function waitForNetworkIdle(timeoutMs = 3000): Promise<void> {
  // Simple heuristic: wait for DOM stable + a short pause
  return new Promise((resolve) => {
    waitForDomStable(timeoutMs).then(() => {
      setTimeout(resolve, 200);
    });
  });
}

async function applyWaitStrategy(
  strategy?: "domStable" | "networkIdle" | "urlChange",
  timeoutMs = 3000,
): Promise<void> {
  switch (strategy) {
    case "domStable":
      return waitForDomStable(timeoutMs);
    case "networkIdle":
      return waitForNetworkIdle(timeoutMs);
    case "urlChange":
      return waitForUrlChange(timeoutMs);
    default:
      // Default short wait for DOM to settle
      return new Promise((r) => setTimeout(r, 150));
  }
}

// ── Element finder ────────────────────────────────────────────────

/**
 * Multi-strategy element finder.
 * 1. Direct CSS selector (primary)
 * 2. aria-label match
 * 3. Text content match on clickable elements
 */
function findElement(selector: string): Element | null {
  // Strategy 1: Direct CSS selector
  try {
    const el = document.querySelector(selector);
    if (el) {
      console.log("%c[PageClick:CS] findElement (CSS match):", "color: #22d3ee", {
        selector,
        tagName: el.tagName,
      });
      return el;
    }
  } catch (e) {
    // Invalid CSS selector — fall through to alternatives
    console.warn("%c[PageClick:CS] Invalid CSS selector:", "color: #ef4444", selector, e);
  }

  // Strategy 2: Try as aria-label
  try {
    const byAria = document.querySelector(`[aria-label="${CSS.escape(selector)}"]`);
    if (byAria) {
      console.log("%c[PageClick:CS] findElement (aria-label match):", "color: #a78bfa", {
        selector,
        tagName: byAria.tagName,
      });
      return byAria;
    }
  } catch { /* ignore */ }

  // Strategy 3: Text content match on clickable elements
  const selectorLower = selector.toLowerCase().trim();
  if (selectorLower.length > 2 && selectorLower.length < 100 && typeof document.querySelectorAll === "function") {
    const clickable = document.querySelectorAll(
      'a, button, [role="button"], [role="link"], [role="menuitem"], [role="tab"]',
    );
    for (const el of clickable) {
      const text = el.textContent?.trim().toLowerCase() || "";
      if (text === selectorLower || text.includes(selectorLower)) {
        console.log("%c[PageClick:CS] findElement (text match):", "color: #fbbf24", {
          selector,
          matchedText: el.textContent?.trim().slice(0, 60),
          tagName: el.tagName,
        });
        return el;
      }
    }
  }

  console.warn("%c[PageClick:CS] findElement: no match found", "color: #ef4444", selector);
  return null;
}

/**
 * Check if an element is visible and interactable (not hidden, not zero-size).
 */
function isInteractable(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return false;
  // Guard: getComputedStyle may not exist in unit-test environments
  if (typeof window.getComputedStyle !== "function") return true;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.pointerEvents === "none") return false;
  if ((el as HTMLElement).offsetParent === null && style.position !== "fixed" && style.position !== "sticky") return false;
  return true;
}

/**
 * Build a post-action observation snapshot for the model.
 */
function buildObservation(el: Element | null): ExecutionResult["observation"] {
  return {
    url: window.location.href,
    title: document.title,
    elementFound: !!el,
    elementVisible: el ? (el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0) : false,
    elementTag: el?.tagName,
  };
}

function scrollIntoViewIfNeeded(el: Element): void {
  const rect = el.getBoundingClientRect();
  const inView =
    rect.top >= 0 &&
    rect.left >= 0 &&
    rect.bottom <= window.innerHeight &&
    rect.right <= window.innerWidth;

  if (!inView) {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

// ── Visual feedback flash ─────────────────────────────────────────

function flashElement(el: Element): void {
  const overlay = document.createElement("div");
  overlay.id = "__pc-action-flash";
  const rect = el.getBoundingClientRect();
  overlay.style.cssText = `
        position: fixed;
        top: ${rect.top - 2}px;
        left: ${rect.left - 2}px;
        width: ${rect.width + 4}px;
        height: ${rect.height + 4}px;
        border: 2px solid #34d399;
        border-radius: 4px;
        background: rgba(52, 211, 153, 0.12);
        pointer-events: none;
        z-index: 2147483647;
        transition: opacity 0.5s ease;
        box-shadow: 0 0 12px rgba(52, 211, 153, 0.4);
    `;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 500);
  }, 800);
}

function flashError(el: Element): void {
  const overlay = document.createElement("div");
  overlay.id = "__pc-action-flash-error";
  const rect = el.getBoundingClientRect();
  overlay.style.cssText = `
        position: fixed;
        top: ${rect.top - 2}px;
        left: ${rect.left - 2}px;
        width: ${rect.width + 4}px;
        height: ${rect.height + 4}px;
        border: 2px solid #ef4444;
        border-radius: 4px;
        background: rgba(239, 68, 68, 0.12);
        pointer-events: none;
        z-index: 2147483647;
        transition: opacity 0.5s ease;
        box-shadow: 0 0 12px rgba(239, 68, 68, 0.4);
    `;
  document.body.appendChild(overlay);
  setTimeout(() => {
    overlay.style.opacity = "0";
    setTimeout(() => overlay.remove(), 500);
  }, 800);
}

// ── Action handlers ───────────────────────────────────────────────

async function executeClick(el: Element): Promise<void> {
  scrollIntoViewIfNeeded(el);
  await new Promise((r) => setTimeout(r, 100)); // let scroll finish

  // For native radio buttons and checkboxes, toggle directly
  if (
    el instanceof HTMLInputElement &&
    (el.type === "radio" || el.type === "checkbox")
  ) {
    el.focus();
    el.click();
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  // For custom elements (Google Forms uses div[role="radio"], div[role="checkbox"], etc.)
  // Dispatch a full mouse event sequence for maximum compatibility
  if (el instanceof HTMLElement) {
    el.focus();
    // Full mouse event sequence mimics real user interaction
    el.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    el.dispatchEvent(
      new MouseEvent("mouseup", {
        bubbles: true,
        cancelable: true,
        view: window,
      }),
    );
    el.click();
  } else {
    el.dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true }),
    );
  }
}

async function detectAutocompletePopup(timeoutMs = 500): Promise<boolean> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const popup = document.querySelector(
      '[role="listbox"], [role="combobox"][aria-expanded="true"]',
    ) as Element | null;
    if (popup) {
      const rect = popup.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) return true;
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  return false;
}

function setInputValueNative(
  input: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  const setter = descriptor?.set;
  if (!setter) {
    input.value = value;
    return;
  }
  setter.call(input, value);
}

async function executeInputWithOptions(
  el: Element,
  value: string,
  clearFirst: boolean,
): Promise<{ verified: boolean; autocompleteShown: boolean; actualValue: string }> {
  scrollIntoViewIfNeeded(el);
  await new Promise((r) => setTimeout(r, 100));

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    const initialValue = el.value || "";

    if (clearFirst) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }

    // Type character by character for better React compatibility
    for (const char of value) {
      el.value += char;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(
        new KeyboardEvent("keydown", { key: char, bubbles: true }),
      );
      el.dispatchEvent(
        new KeyboardEvent("keyup", { key: char, bubbles: true }),
      );
      await new Promise((r) => setTimeout(r, 15)); // typing delay
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    const expectedValue = clearFirst ? value : initialValue + value;
    let actualValue = el.value;
    if (actualValue !== expectedValue) {
      setInputValueNative(el, expectedValue);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      actualValue = el.value;
    }
    const autocompleteShown = await detectAutocompletePopup(500);
    return {
      verified: actualValue === expectedValue,
      autocompleteShown,
      actualValue,
    };
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    const initialText = el.textContent || "";
    el.textContent = clearFirst ? value : initialText + value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const expectedValue = clearFirst ? value : initialText + value;
    const actualValue = el.textContent || "";
    const autocompleteShown = await detectAutocompletePopup(500);
    return {
      verified: actualValue === expectedValue,
      autocompleteShown,
      actualValue,
    };
  }

  return {
    verified: false,
    autocompleteShown: false,
    actualValue: "",
  };
}

async function executeScroll(
  el: Element,
  value?: string,
): Promise<{ moved: boolean }> {
  const direction = value || "down";
  const amount = 300;

  if (el === document.documentElement || el === document.body) {
    const before = Math.round(window.scrollY);
    // Scroll window
    switch (direction) {
      case "up":
        window.scrollBy({ top: -amount, behavior: "smooth" });
        break;
      case "down":
        window.scrollBy({ top: amount, behavior: "smooth" });
        break;
      case "top":
        window.scrollTo({ top: 0, behavior: "smooth" });
        break;
      case "bottom":
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: "smooth",
        });
        break;
    }
    await new Promise((r) => setTimeout(r, 400));
    const after = Math.round(window.scrollY);
    return { moved: after !== before };
  } else {
    const beforeTop = Math.round(el.getBoundingClientRect().top);
    scrollIntoViewIfNeeded(el);
    await new Promise((r) => setTimeout(r, 400));
    const afterTop = Math.round(el.getBoundingClientRect().top);
    return { moved: afterTop !== beforeTop };
  }
}

async function executeExtract(el: Element): Promise<string> {
  scrollIntoViewIfNeeded(el);

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    return el.value;
  }
  if (el instanceof HTMLSelectElement) {
    return el.options[el.selectedIndex]?.text || el.value;
  }
  if (el instanceof HTMLImageElement) {
    return el.alt || el.src;
  }
  if (el instanceof HTMLAnchorElement) {
    return `${el.textContent?.trim() || ""} (${el.href})`;
  }
  return el.textContent?.trim() || "";
}

async function executeNavigate(_el: Element, value?: string): Promise<void> {
  if (value) {
    window.location.href = value;
  }
}

async function executeSelect(el: Element, value: string): Promise<void> {
  scrollIntoViewIfNeeded(el);
  await new Promise((r) => setTimeout(r, 100));

  if (el instanceof HTMLSelectElement) {
    // Find the option that matches by value or text
    const options = Array.from(el.options);
    const match = options.find(
      (opt) =>
        opt.value.toLowerCase() === value.toLowerCase() ||
        opt.textContent?.trim().toLowerCase() === value.toLowerCase(),
    );

    if (match) {
      el.value = match.value;
    } else {
      // Try partial match
      const partial = options.find(
        (opt) =>
          opt.textContent?.trim().toLowerCase().includes(value.toLowerCase()) ||
          opt.value.toLowerCase().includes(value.toLowerCase()),
      );
      if (partial) {
        el.value = partial.value;
      } else {
        throw new Error(`Option "${value}" not found in select element`);
      }
    }

    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  } else {
    // For custom dropdowns, try clicking the element that matches the value text
    const items = el.querySelectorAll(
      '[role="option"], [role="menuitem"], li, [data-value]',
    );
    for (const item of Array.from(items)) {
      if (
        item.textContent?.trim().toLowerCase().includes(value.toLowerCase())
      ) {
        (item as HTMLElement).click();
        return;
      }
    }
    throw new Error(`Option "${value}" not found in custom select element`);
  }
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

async function executeSelectDate(el: Element, value: string): Promise<void> {
  if (!isIsoDate(value)) {
    throw new Error(
      `Invalid date format "${value}". Expected YYYY-MM-DD.`,
    );
  }

  scrollIntoViewIfNeeded(el);
  await new Promise((r) => setTimeout(r, 100));

  if (el instanceof HTMLInputElement) {
    el.focus();
    if (typeof el.showPicker === "function") {
      try {
        el.showPicker();
      } catch {
        // Ignore and continue with value assignment fallback.
      }
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));

    if (el.value !== value) {
      throw new Error(
        `Date input did not accept value "${value}". Actual value is "${el.value}".`,
      );
    }
    return;
  }

  // Fallback for custom date controls: set text and fire input events.
  if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  throw new Error("select_date target must be an input or editable date field");
}

// ── Main executor ─────────────────────────────────────────────────

export async function executeAction(
  step: ActionStep,
): Promise<ExecutionResult> {
  const start = performance.now();
  console.log(
    "%c[PageClick:CS] ┌── executeAction called",
    "color: #22d3ee; font-weight: bold",
    {
      action: step.action,
      selector: step.selector,
      value: step.value,
      description: step.description,
      waitFor: step.waitFor,
    },
  );

  const el = findElement(step.selector);
  if (!el) {
    console.warn(
      "%c[PageClick:CS] └── Element NOT FOUND:",
      "color: #ef4444; font-weight: bold",
      step.selector,
    );
    return {
      success: false,
      action: step.action,
      selector: step.selector,
      error: `Element not found: ${step.selector}. Try a different selector from the Interactive Elements list.`,
      observation: buildObservation(null),
      durationMs: performance.now() - start,
    };
  }

  // Check interactability before proceeding
  if (!isInteractable(el) && step.action !== "extract" && step.action !== "scroll") {
    console.warn(
      "%c[PageClick:CS] └── Element NOT INTERACTABLE:",
      "color: #f59e0b; font-weight: bold",
      { tag: el.tagName, rect: el.getBoundingClientRect() },
    );
    return {
      success: false,
      action: step.action,
      selector: step.selector,
      error: `Element found but not interactable (hidden, zero-size, or pointer-events:none). Tag: ${el.tagName}. Try scrolling or use a different selector.`,
      observation: buildObservation(el),
      durationMs: performance.now() - start,
    };
  }

  console.log("%c[PageClick:CS] │ Element found:", "color: #22d3ee", {
    tagName: el.tagName,
    id: (el as any).id,
    className: el.className?.toString?.()?.slice(0, 80),
    textContent: el.textContent?.slice(0, 60),
    visible: el.getBoundingClientRect().width > 0,
  });

  try {
    switch (step.action) {
      case "click":
        console.log("%c[PageClick:CS] │ Executing CLICK", "color: #22d3ee");
        await executeClick(el);
        flashElement(el);
        break;

      case "input":
        if (!step.value) {
          console.warn(
            "%c[PageClick:CS] └── Input requires value!",
            "color: #ef4444",
          );
          return {
            success: false,
            action: step.action,
            selector: step.selector,
            error: "Input action requires a value",
            durationMs: performance.now() - start,
          };
        }
        console.log(
          "%c[PageClick:CS] │ Executing INPUT:",
          "color: #22d3ee",
          step.value,
        );
        const inputResult = await executeInputWithOptions(
          el,
          step.value,
          step.clearFirst ?? true,
        );
        if (!inputResult.verified) {
          // CDP fallback: try typing via CDP Input.insertText
          console.log(
            "%c[PageClick:CS] │ DOM input failed, trying CDP fallback...",
            "color: #f59e0b",
          );
          // Focus the target element first
          if (el instanceof HTMLElement) {
            el.focus();
            el.click();
          }
          // Short delay for focus to take effect
          await new Promise((r) => setTimeout(r, 100));
          const cdpResult = await cdpInsertText(step.value);
          if (!cdpResult.ok) {
            return {
              success: false,
              action: step.action,
              selector: step.selector,
              error: `Input failed (DOM: "${inputResult.actualValue}", CDP: ${cdpResult.error || "failed"})`,
              durationMs: performance.now() - start,
            };
          }
          console.log(
            "%c[PageClick:CS] │ CDP input succeeded!",
            "color: #22c55e",
          );
        }
        flashElement(el);
        if (inputResult.autocompleteShown) {
          const duration = performance.now() - start;
          return {
            success: true,
            action: step.action,
            selector: step.selector,
            extractedData: "Autocomplete dropdown detected",
            durationMs: duration,
          };
        }
        break;

      case "scroll":
        console.log(
          "%c[PageClick:CS] │ Executing SCROLL:",
          "color: #22d3ee",
          step.value || "down",
        );
        const scrollResult = await executeScroll(el, step.value);
        if (!scrollResult.moved) {
          return {
            success: false,
            action: step.action,
            selector: step.selector,
            error: "Scroll had no effect (already at boundary or element position unchanged)",
            durationMs: performance.now() - start,
          };
        }
        break;

      case "extract":
        console.log("%c[PageClick:CS] │ Executing EXTRACT", "color: #22d3ee");
        const data = await executeExtract(el);
        console.log(
          "%c[PageClick:CS] └── Extracted:",
          "color: #34d399; font-weight: bold",
          data?.slice(0, 200),
        );
        flashElement(el);
        return {
          success: true,
          action: step.action,
          selector: step.selector,
          extractedData: data,
          durationMs: performance.now() - start,
        };

      case "navigate":
        console.log(
          "%c[PageClick:CS] │ Executing NAVIGATE (content script):",
          "color: #22d3ee",
          step.value,
        );
        await executeNavigate(el, step.value || (el as HTMLAnchorElement).href);
        break;

      case "select":
        if (!step.value) {
          console.warn(
            "%c[PageClick:CS] └── Select requires value!",
            "color: #ef4444",
          );
          return {
            success: false,
            action: step.action,
            selector: step.selector,
            error: "Select action requires a value",
            durationMs: performance.now() - start,
          };
        }
        console.log(
          "%c[PageClick:CS] │ Executing SELECT:",
          "color: #22d3ee",
          step.value,
        );
        await executeSelect(el, step.value);
        flashElement(el);
        break;

      case "select_date":
        if (!step.value) {
          return {
            success: false,
            action: step.action,
            selector: step.selector,
            error: "select_date action requires a date value (YYYY-MM-DD)",
            durationMs: performance.now() - start,
          };
        }
        console.log(
          "%c[PageClick:CS] │ Executing SELECT_DATE:",
          "color: #22d3ee",
          step.value,
        );
        await executeSelectDate(el, step.value);
        flashElement(el);
        break;

      case "press_key": {
        if (!step.value) {
          return {
            success: false,
            action: step.action,
            selector: step.selector,
            error: "press_key action requires a key name (e.g., 'Enter', 'Escape')",
            durationMs: performance.now() - start,
          };
        }
        console.log(
          "%c[PageClick:CS] │ Executing PRESS_KEY:",
          "color: #22d3ee",
          step.value,
        );
        scrollIntoViewIfNeeded(el);
        if (el instanceof HTMLElement) el.focus();
        const key = step.value;
        const keyCode = key === "Enter" ? 13 : key === "Escape" ? 27 : key === "Tab" ? 9 : key === "Backspace" ? 8 : key === "Space" ? 32 : 0;
        el.dispatchEvent(new KeyboardEvent("keydown", { key, code: key, keyCode, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent("keypress", { key, code: key, keyCode, bubbles: true, cancelable: true }));
        el.dispatchEvent(new KeyboardEvent("keyup", { key, code: key, keyCode, bubbles: true, cancelable: true }));
        // For Enter key on input elements, also submit the parent form
        if (key === "Enter" && el.closest("form")) {
          const form = el.closest("form");
          if (form) {
            form.requestSubmit?.() ?? form.submit();
          }
        }
        // CDP fallback: also dispatch via CDP for canvas-based editors
        const cdpKeyResult = await cdpDispatchKey(key);
        if (cdpKeyResult.ok) {
          console.log(
            "%c[PageClick:CS] │ CDP key dispatch succeeded",
            "color: #22c55e",
          );
        }
        flashElement(el);

        // IMPORTANT: For Enter key specifically, do NOT wait for DOM stability.
        // When Enter submits a form/search box it triggers a page navigation,
        // and calling waitForDomStable() on a navigating page throws a DOM
        // disconnection error, causing a false success=false result.
        // The outer runAgentLoop already calls waitForPageLoad() after press_key Enter.
        if (key === "Enter") {
          return {
            success: true,
            action: step.action,
            selector: step.selector,
            observation: buildObservation(el),
            durationMs: performance.now() - start,
          };
        }
        break;
      }

      default:
        console.warn(
          "%c[PageClick:CS] └── Unknown action:",
          "color: #ef4444",
          step.action,
        );
        return {
          success: false,
          action: step.action,
          selector: step.selector,
          error: `Unknown action: ${step.action}`,
          durationMs: performance.now() - start,
        };
    }

    // Apply wait strategy
    if (
      step.action === "click" ||
      step.action === "input" ||
      step.action === "select" ||
      step.action === "select_date" ||
      step.action === "press_key"
    ) {
      // Interaction actions often trigger SPA re-renders without URL changes.
      await waitForDomStable(step.timeoutMs ?? 3000);
    }

    console.log(
      "%c[PageClick:CS] │ Applying wait strategy:",
      "color: #22d3ee",
      step.waitFor || "default (150ms)",
    );
    await applyWaitStrategy(step.waitFor, step.timeoutMs);

    const duration = performance.now() - start;
    console.log(
      "%c[PageClick:CS] └── SUCCESS in",
      "color: #34d399; font-weight: bold",
      `${duration.toFixed(0)}ms`,
    );
    return {
      success: true,
      action: step.action,
      selector: step.selector,
      observation: buildObservation(el),
      durationMs: duration,
    };
  } catch (err: any) {
    const errMsg: string = err?.message || "Action execution failed";
    console.error(
      "%c[PageClick:CS] └── FAILED:",
      "color: #ef4444; font-weight: bold",
      err,
    );
    flashError(el);
    // If the error is due to page navigation / DOM teardown, treat as success.
    // This handles cases where the action triggered a navigation but waitForDomStable
    // or observation threw before we could return cleanly.
    const isNavigationTeardown = /unloaded|detached|navigat|disconnected|frame|no longer exists|cannot access/i.test(errMsg);
    if (isNavigationTeardown) {
      console.log("%c[PageClick:CS] └── Navigation teardown detected — treating as success", "color: #f59e0b; font-weight: bold");
      return {
        success: true,
        action: step.action,
        selector: step.selector,
        observation: { url: window.location.href, title: document.title, elementFound: true, elementVisible: true },
        durationMs: performance.now() - start,
      };
    }
    return {
      success: false,
      action: step.action,
      selector: step.selector,
      error: errMsg,
      observation: buildObservation(el),
      durationMs: performance.now() - start,
    };
  }
}
