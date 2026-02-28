/**
 * Content script: DOM Snapshot Capture + Sensitive Field Redaction
 *
 * Injected into the active tab to capture a compact, structured
 * representation of the visible DOM. Responds to CAPTURE_PAGE messages
 * from the background service worker.
 */

/// <reference types="chrome" />

import type {
  DOMNode,
  PageSnapshot,
  CapturePageResponse,
} from "../shared/messages";
import { executeAction } from "./action-executor";

// ── Sensitive field detection (§3.2) ──────────────────────────────

const SENSITIVE_INPUT_TYPES = new Set(["password"]);

const SENSITIVE_AUTOCOMPLETE = new Set([
  "cc-number",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
  "cc-csc",
  "cc-name",
  "cc-type",
  "cc-given-name",
  "cc-family-name",
]);

const SENSITIVE_NAME_PATTERNS =
  /password|passwd|pwd|cvv|cvc|card.?num|otp|pin|secret|token/i;

function isSensitiveElement(el: Element): boolean {
  if (el instanceof HTMLInputElement) {
    // Type-based check
    if (SENSITIVE_INPUT_TYPES.has(el.type)) return true;

    // Autocomplete-based check
    const ac = el.getAttribute("autocomplete") || "";
    if (SENSITIVE_AUTOCOMPLETE.has(ac)) return true;
    if (ac.startsWith("cc-")) return true;

    // Name/id heuristic
    const nameId = `${el.name || ""} ${el.id || ""} ${el.getAttribute("placeholder") || ""}`;
    if (SENSITIVE_NAME_PATTERNS.test(nameId)) return true;
  }

  return false;
}

// ── CSS selector path builder ─────────────────────────────────────

function buildSelector(el: Element): string {
  // Prefer stable identifiers
  if (el.id) return `#${CSS.escape(el.id)}`;

  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) {
    const tag = el.tagName.toLowerCase();
    return `${tag}[aria-label="${CSS.escape(ariaLabel)}"]`;
  }

  const testId = el.getAttribute("data-testid");
  if (testId) return `[data-testid="${CSS.escape(testId)}"]`;

  // Fallback: build a path from parent
  const parts: string[] = [];
  let current: Element | null = el;
  while (current && current !== document.documentElement) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parent: Element | null = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c: Element) => c.tagName === current!.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(selector);
    current = parent;
  }
  return parts.join(" > ");
}

// ── Visibility check ──────────────────────────────────────────────

function isVisible(el: Element): boolean {
  const style = window.getComputedStyle(el);
  if (
    style.display === "none" ||
    style.visibility === "hidden" ||
    style.opacity === "0"
  ) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  // Must have nonzero dimensions and be at least partially in viewport
  if (rect.width === 0 || rect.height === 0) return false;
  if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
  if (rect.right < 0 || rect.left > window.innerWidth) return false;
  return true;
}

// ── Tags we care about for structured capture ─────────────────────

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "details",
  "summary",
]);

const SEMANTIC_TAGS = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "nav",
  "main",
  "form",
  "label",
  "img",
  "video",
  "audio",
  "table",
  "th",
  "td",
]);

function shouldCapture(el: Element): boolean {
  const tag = el.tagName.toLowerCase();

  // Always capture interactive elements
  if (INTERACTIVE_TAGS.has(tag)) return true;

  // Capture semantic elements
  if (SEMANTIC_TAGS.has(tag)) return true;

  // Capture elements with click handlers or roles
  const role = el.getAttribute("role");
  if (
    role &&
    [
      "button",
      "link",
      "tab",
      "menuitem",
      "checkbox",
      "radio",
      "switch",
      "option",
    ].includes(role)
  ) {
    return true;
  }

  // Capture elements with aria-label (they're likely interactive)
  if (el.getAttribute("aria-label")) return true;

  // Capture elements with data-testid
  if (el.getAttribute("data-testid")) return true;

  return false;
}

// ── Main DOM walker ───────────────────────────────────────────────

const MAX_NODES = 800;
const MAX_TEXT_LENGTH = 120;

function captureDOM(): DOMNode[] {
  const nodes: DOMNode[] = [];
  let nodeId = 0;

  const walker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as Element;
        // Skip PageClick's own injected elements
        if (el.id?.startsWith("__pc-")) return NodeFilter.FILTER_REJECT;
        // Skip invisible
        if (!isVisible(el)) return NodeFilter.FILTER_SKIP;
        return NodeFilter.FILTER_ACCEPT;
      },
    },
  );

  let el: Element | null = walker.currentNode as Element;
  while (el && nodes.length < MAX_NODES) {
    if (shouldCapture(el)) {
      const tag = el.tagName.toLowerCase();
      const rect = el.getBoundingClientRect();

      // Build attributes — only useful ones
      const attrs: Record<string, string> = {};
      const role = el.getAttribute("role");
      if (role) attrs.role = role;
      const ariaLabel = el.getAttribute("aria-label");
      if (ariaLabel) attrs["aria-label"] = ariaLabel;
      const testId = el.getAttribute("data-testid");
      if (testId) attrs["data-testid"] = testId;
      const href = el.getAttribute("href");
      if (href) attrs.href = href;
      const type = el.getAttribute("type");
      if (type) attrs.type = type;
      const placeholder = el.getAttribute("placeholder");
      if (placeholder) attrs.placeholder = placeholder;
      const name = el.getAttribute("name");
      if (name) attrs.name = name;
      const disabled = el.getAttribute("disabled");
      if (disabled !== null) attrs.disabled = "true";

      // Handle inputs: metadata only (never send values), redact sensitive ones
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        if (isSensitiveElement(el)) {
          attrs._redacted = "true";
        } else {
          // Send type + placeholder but NOT the value
          attrs.type = (el as HTMLInputElement).type || "text";
          // Include checked state for radio/checkbox
          if (
            el instanceof HTMLInputElement &&
            (el.type === "radio" || el.type === "checkbox")
          ) {
            attrs.checked = el.checked ? "true" : "false";
          }
          // Include current value for text fields so AI knows what's already filled
          if (
            el instanceof HTMLInputElement &&
            !["password", "hidden"].includes(el.type) &&
            el.value
          ) {
            attrs.value = el.value.substring(0, 100);
          }
          if (el instanceof HTMLTextAreaElement && el.value) {
            attrs.value = el.value.substring(0, 100);
          }
        }
      }

      // Handle select elements: include current value and options
      if (el instanceof HTMLSelectElement) {
        const selectedOpt = el.options[el.selectedIndex];
        if (selectedOpt) attrs.value = selectedOpt.text.substring(0, 80);
        // Include available options (up to 10)
        const optTexts = Array.from(el.options)
          .slice(0, 10)
          .map((o) => o.text.trim());
        attrs.options = optTexts.join(" | ");
      }

      // Include ARIA state attributes for complex UIs (GCP, wizards, etc.)
      const ariaChecked = el.getAttribute("aria-checked");
      if (ariaChecked) attrs["aria-checked"] = ariaChecked;
      const ariaExpanded = el.getAttribute("aria-expanded");
      if (ariaExpanded) attrs["aria-expanded"] = ariaExpanded;
      const ariaSelected = el.getAttribute("aria-selected");
      if (ariaSelected) attrs["aria-selected"] = ariaSelected;
      const ariaCurrent = el.getAttribute("aria-current");
      if (ariaCurrent) attrs["aria-current"] = ariaCurrent;

      // Get visible text (truncated)
      let text = "";
      if (tag === "input" || tag === "textarea") {
        text = placeholder || "";
      } else if (tag === "img") {
        text = el.getAttribute("alt") || "";
      } else {
        text = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length > MAX_TEXT_LENGTH) {
          text = text.substring(0, MAX_TEXT_LENGTH) + "…";
        }
      }

      nodes.push({
        id: nodeId++,
        tag,
        text,
        attrs,
        bbox: {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        },
        path: buildSelector(el),
      });
    }

    const next = walker.nextNode();
    if (!next) break;
    el = next as Element;
  }

  return nodes;
}

// ── Plain text fallback ───────────────────────────────────────────

function captureTextContent(): string {
  const clone = document.body.cloneNode(true) as HTMLElement;
  // Strip PageClick elements
  clone.querySelectorAll('[id^="__pc-"]').forEach((el) => el.remove());
  let text = clone.innerText || "";
  text = text.replace(/\s+/g, " ").trim();
  if (text.length > 3000) {
    text = text.substring(0, 3000) + "...";
  }
  return text;
}

// ── Form/flow context detection ───────────────────────────────────

function detectFormContext(): import("../shared/messages").FormContext | undefined {
  // Detect step indicators ("Step 2 of 5", "2/5", etc.)
  let stepIndicator: string | undefined;
  const stepPatterns = [
    /step\s+(\d+)\s+(?:of|\/)\s+(\d+)/i,
    /(\d+)\s*(?:of|\/)\s*(\d+)\s*step/i,
  ];
  const bodyText = document.body.innerText || "";
  for (const pat of stepPatterns) {
    const m = bodyText.match(pat);
    if (m) { stepIndicator = m[0].trim(); break; }
  }

  // Check for aria-based step indicators
  const currentStep = document.querySelector('[aria-current="step"], [aria-current="page"], .stepper .active, .step.active, .wizard-step.current');
  const activeStep = currentStep?.textContent?.replace(/\s+/g, " ").trim().substring(0, 80);

  // Detect progress bars
  let progressPercent: number | undefined;
  const progressBar = document.querySelector('[role="progressbar"]') as HTMLElement | null;
  if (progressBar) {
    const val = progressBar.getAttribute("aria-valuenow");
    const max = progressBar.getAttribute("aria-valuemax") || "100";
    if (val) progressPercent = Math.round((parseFloat(val) / parseFloat(max)) * 100);
  }

  // Count form fields (filled vs empty)
  const allInputs = document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), textarea, select'
  );
  let totalFields = 0;
  let filledFields = 0;
  const unfilledFields: string[] = [];

  allInputs.forEach((el) => {
    if (!isVisible(el)) return;
    if (isSensitiveElement(el)) return; // skip password/CC fields
    totalFields++;
    const hasValue = el instanceof HTMLSelectElement
      ? el.selectedIndex > 0
      : !!el.value.trim();
    if (hasValue) {
      filledFields++;
    } else if (unfilledFields.length < 10) {
      const label = el.getAttribute("aria-label")
        || el.getAttribute("placeholder")
        || el.getAttribute("name")
        || el.closest("label")?.textContent?.trim().substring(0, 50)
        || `${el.tagName.toLowerCase()}[${el.type || "text"}]`;
      unfilledFields.push(label);
    }
  });

  // Only return if there's something meaningful
  if (!stepIndicator && !activeStep && progressPercent === undefined && totalFields === 0) {
    return undefined;
  }

  return { stepIndicator, progressPercent, activeStep, totalFields, filledFields, unfilledFields };
}

// ── Loading indicator detection ───────────────────────────────────

function hasLoadingIndicators(): boolean {
  // Check for common loading patterns
  const loadingSelectors = [
    '[aria-busy="true"]',
    '.loading', '.spinner', '.skeleton',
    '[class*="loading"]', '[class*="spinner"]', '[class*="skeleton"]',
    '[role="progressbar"][aria-valuenow="0"]',
    '.shimmer', '[class*="shimmer"]',
  ];
  for (const sel of loadingSelectors) {
    try {
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return true;
    } catch { /* invalid selector */ }
  }
  return false;
}

// ── Build full snapshot ───────────────────────────────────────────

function buildSnapshot(): PageSnapshot {
  const metaDesc =
    document
      .querySelector('meta[name="description"]')
      ?.getAttribute("content") || "";

  const nodes = captureDOM();
  
  // Sort nodes: viewport-visible first (by Y position), then off-screen
  nodes.sort((a, b) => {
    const aVisible = a.bbox.y >= 0 && a.bbox.y < window.innerHeight;
    const bVisible = b.bbox.y >= 0 && b.bbox.y < window.innerHeight;
    if (aVisible && !bVisible) return -1;
    if (!aVisible && bVisible) return 1;
    return a.bbox.y - b.bbox.y;
  });

  return {
    url: window.location.href,
    title: document.title || "",
    description: metaDesc,
    nodes,
    textContent: captureTextContent(),
    capturedAt: Date.now(),
    readyState: document.readyState,
    hasLoadingIndicators: hasLoadingIndicators(),
    formContext: detectFormContext(),
  };
}

// ── Message listener ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "CAPTURE_PAGE") {
    try {
      const snapshot = buildSnapshot();
      const response: CapturePageResponse = {
        type: "CAPTURE_PAGE_RESULT",
        payload: snapshot,
      };
      sendResponse(response);
    } catch (err: any) {
      const response: CapturePageResponse = {
        type: "CAPTURE_PAGE_RESULT",
        payload: null,
        error: err.message || "DOM capture failed",
      };
      sendResponse(response);
    }
    return true; // keep channel open for async response
  }

  if (message.type === "EXECUTE_ACTION") {
    console.log(
      "%c[PageClick:CS] EXECUTE_ACTION received in content script:",
      "color: #22d3ee; font-weight: bold",
      message.step,
    );
    executeAction(message.step)
      .then((result) => {
        console.log(
          "%c[PageClick:CS] EXECUTE_ACTION result:",
          "color: #22d3ee",
          result,
        );
        sendResponse({ type: "EXECUTE_ACTION_RESULT", result });
      })
      .catch((err: any) => {
        console.error(
          "%c[PageClick:CS] EXECUTE_ACTION error:",
          "color: #ef4444",
          err,
        );
        sendResponse({
          type: "EXECUTE_ACTION_RESULT",
          result: {
            success: false,
            action: message.step.action,
            selector: message.step.selector,
            error: err.message || "Execution failed",
            durationMs: 0,
          },
        });
      });
    return true; // async response
  }

  if (message.type === "HIGHLIGHT_ELEMENT") {
    try {
      const el = document.querySelector(message.selector);
      if (el) {
        // Remove any previous highlight
        document.getElementById("__pc-highlight")?.remove();

        const rect = el.getBoundingClientRect();
        const overlay = document.createElement("div");
        overlay.id = "__pc-highlight";
        overlay.style.cssText = `
                        position: fixed;
                        top: ${rect.top - 3}px;
                        left: ${rect.left - 3}px;
                        width: ${rect.width + 6}px;
                        height: ${rect.height + 6}px;
                        border: 2px solid #00d4ff;
                        border-radius: 4px;
                        background: rgba(0, 212, 255, 0.08);
                        pointer-events: none;
                        z-index: 2147483647;
                        transition: all 0.2s ease;
                        box-shadow: 0 0 8px rgba(0, 212, 255, 0.3);
                    `;
        document.body.appendChild(overlay);
      }
      sendResponse({ ok: true });
    } catch {
      sendResponse({ ok: false });
    }
    return true;
  }

  if (message.type === "CLEAR_HIGHLIGHT") {
    document.getElementById("__pc-highlight")?.remove();
    sendResponse({ ok: true });
    return true;
  }
});
