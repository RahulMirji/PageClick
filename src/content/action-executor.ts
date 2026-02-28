/**
 * Action Executor — runs approved ActionSteps on the page.
 *
 * Handles: click, input, scroll, extract, navigate
 * Each action includes wait strategies and result reporting.
 */

import type { ActionStep } from "../shared/messages";

// ── Types ─────────────────────────────────────────────────────────

export interface ExecutionResult {
  success: boolean;
  action: string;
  selector: string;
  extractedData?: string;
  error?: string;
  durationMs: number;
}

// ── Wait strategies ───────────────────────────────────────────────

function waitForDomStable(timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
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

function findElement(selector: string): Element | null {
  try {
    const el = document.querySelector(selector);
    console.log("%c[PageClick:CS] findElement:", "color: #22d3ee", {
      selector,
      found: !!el,
      tagName: el?.tagName,
      id: (el as any)?.id,
    });
    return el;
  } catch (e) {
    console.warn(
      "%c[PageClick:CS] Invalid selector:",
      "color: #ef4444",
      selector,
      e,
    );
    return null;
  }
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

async function executeInput(el: Element, value: string): Promise<void> {
  scrollIntoViewIfNeeded(el);
  await new Promise((r) => setTimeout(r, 100));

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();

    // Clear existing value
    el.value = "";
    el.dispatchEvent(new Event("input", { bubbles: true }));

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
  } else if (el instanceof HTMLElement && el.isContentEditable) {
    el.focus();
    el.textContent = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

async function executeScroll(el: Element, value?: string): Promise<void> {
  const direction = value || "down";
  const amount = 300;

  if (el === document.documentElement || el === document.body) {
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
  } else {
    scrollIntoViewIfNeeded(el);
  }
  await new Promise((r) => setTimeout(r, 400));
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
      error: `Element not found: ${step.selector}`,
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
        await executeInput(el, step.value);
        flashElement(el);
        break;

      case "scroll":
        console.log(
          "%c[PageClick:CS] │ Executing SCROLL:",
          "color: #22d3ee",
          step.value || "down",
        );
        await executeScroll(el, step.value);
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
      durationMs: duration,
    };
  } catch (err: any) {
    console.error(
      "%c[PageClick:CS] └── FAILED:",
      "color: #ef4444; font-weight: bold",
      err,
    );
    flashError(el);
    return {
      success: false,
      action: step.action,
      selector: step.selector,
      error: err.message || "Action execution failed",
      durationMs: performance.now() - start,
    };
  }
}
