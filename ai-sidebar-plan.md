# AI Sidebar Chrome Extension (Perplexity-style)

**Technical design + implementation plan (MVP → Production)**  
Date: 2026-02-12

> Goal: A Chrome Extension that runs as a persistent sidebar, understands the current page (text + images), answers questions, and can safely execute user-approved actions in the user’s active browser session (click, scroll, type, navigate), similar to Perplexity Assistant UX.

---

## 0) Executive summary

A **hybrid architecture** (Chrome extension + optional cloud inference) is the recommended starting point:

- **Client (extension)** does: page capture (DOM/text + optional screenshots), redaction, local safety policy, UX, and action execution.
- **Cloud** does: heavy multimodal reasoning + action planning (Kimi K2.5 as primary), with fallback to frontier cloud models or a local/offline mode.

This balances:

- **Responsiveness** (small local logic; parallel capture + streaming suggestions)
- **Privacy** (local redaction & policy gate; user-controlled vision capture)
- **Capability** (full-strength multimodal model for grounding + tool orchestration)

---

## 1) Feasibility report

### 1.1 Technical feasibility

**Core capability**: mapping **(DOM + viewport screenshot + goal)** → **ordered, grounded DOM actions** is feasible today, but reliability varies with site complexity.

Typical hard cases:

- SPAs with continuous DOM churn (React/Next/Vue), virtualized lists
- Shadow DOM / Web Components
- Cross-origin iframes
- Anti-bot / CAPTCHA gates
- Highly personalized / AB-tested pages (selector drift)

**Design implication**: the system should be built around:

- robust selectors (aria-label/role/data-testid > id > class > path)
- verification checks (expectText/expectRole/expectBBox)
- step-by-step execution with observation & retry
- human confirmation by default

### 1.2 UX feasibility

A Perplexity-like UX is feasible via Chrome’s **Side Panel API** (persistent sidebar). Best-practice UX patterns:

- Default mode: **Suggest → Preview → Confirm**
- Display: action list with confidence + what will change on page
- Highlight the target element before each click
- “Stop” button that immediately halts execution
- Per-site opt-in permissions + per-site automation toggles

### 1.3 Legal / policy feasibility

Feasible if built with:

- least-privilege permissions
- transparent disclosure of data usage
- no remote code execution (Manifest V3 constraints)
- strict safety (no auto-purchase, no password/payment exfil)

**Note**: individual website ToS may prohibit automation; provide user-facing warning and per-site controls.

---

## 2) Recommended architecture

### 2.1 Architecture options

| Option                   | Summary                  | Pros                                         | Cons                                                                   | Best for                   |
| ------------------------ | ------------------------ | -------------------------------------------- | ---------------------------------------------------------------------- | -------------------------- |
| Client-only              | WebGPU / local inference | Max privacy; offline                         | Hard to do strong vision+agents; big downloads; slower on weak devices | privacy-first, power users |
| **Hybrid (recommended)** | extension + cloud model  | strong capability + decent privacy; scalable | some data leaves device; needs policy layer                            | mainstream product         |
| Cloud-only               | send everything to cloud | simplest                                     | weakest privacy; riskier compliance                                    | internal tooling           |

### 2.2 Hybrid data flow

1. Sidebar captures user goal
2. Content script builds compact page state:

- DOM snapshot (compact)
- visible text (limited)
- page URL/title
- optional screenshot (explicit toggle)

3. Local redaction + policy gate (password/payment blocking)
4. Model API returns:

- answer text
- **action plan JSON** (selectors + verification)
- confidence + risk flags

5. Sidebar previews actions
6. On user confirm: execute actions sequentially in content script with wait/retry
7. Report status back to sidebar (step success/failure)

---

## 3) Security & privacy: design principles

### 3.1 Data that must never leave device

- Password values; password fields
- Payment card number, expiry, CVV, UPI PIN
- Authentication tokens / cookies / localStorage secrets

### 3.2 Redaction strategy (client-side)

- Drop nodes matching sensitive selectors:
  - `input[type=password]`
  - `input[autocomplete^=cc-]`
  - names/ids containing `password`, `cvv`, `card`, `otp` (heuristic)
- For remaining inputs: send only metadata (type, placeholder) but not values
- Optional: OCR redaction if screenshot contains sensitive areas (only if you implement screenshot mode)

### 3.3 Safety policy layer

Default safe rules:

- Never click buttons whose accessible name matches: `Pay`, `Place order`, `Buy`, `Checkout`, `Confirm`, `Delete`, `Remove`, `Close account`
- Never submit forms automatically
- Require explicit confirmation for:
  - any navigation to a new domain
  - any action that changes account state

---

## 4) Component design (Manifest V3)

### 4.1 Manifest

```json
{
  "manifest_version": 3,
  "name": "AI Sidebar Assistant",
  "version": "0.1.0",
  "description": "Perplexity-style sidebar assistant that understands pages and suggests safe actions.",
  "permissions": ["activeTab", "scripting", "storage", "sidePanel"],
  "optional_host_permissions": ["https://*/*", "http://*/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "side_panel": { "default_path": "sidebar.html" },
  "action": { "default_title": "Open Assistant" },
  "content_security_policy": {
    "extension_pages": "script-src 'self'; object-src 'self'"
  }
}
```

**Why these permissions**:

- `activeTab`: access only the active tab on user gesture
- `scripting`: inject scripts on demand
- `storage`: store settings + per-site permissions
- `sidePanel`: persistent sidebar UI

### 4.2 Messaging bus

Use a single schema for messages among:

- sidebar UI ↔ background
- background ↔ content script

Example envelope:

```ts
type Msg = {
  id: string;
  type: "CAPTURE_PAGE" | "PLAN" | "EXECUTE" | "STATUS" | "ERROR";
  tabId?: number;
  payload?: any;
};
```

---

## 5) Page state capture (DOM + visuals)

### 5.1 Compact DOM snapshot

Goals:

- Keep under ~50–200 KB per request
- Preserve semantics + stable identifiers
- Include bounding boxes for grounding

Suggested node schema:

```json
{
  "id": 123,
  "tag": "button",
  "text": "Add to cart",
  "attrs": {
    "role": "button",
    "aria-label": "Add to cart",
    "data-testid": "add"
  },
  "bbox": { "x": 10, "y": 420, "width": 120, "height": 40 },
  "path": "body > div:nth-of-type(2) > button"
}
```

### 5.2 Screenshot capture (optional)

For vision mode:

- only capture **visible viewport** (not full page) by default
- require user toggle per-site
- crop to specific element for “verify” steps if needed

---

## 6) Action plan format (canonical)

```json
{
  "explanation": "What will be done and why",
  "actions": [
    {
      "action": "click|input|scroll|extract|navigate",
      "selector": "CSS or XPath",
      "expect": { "textIncludes": "Shipping", "role": "button" },
      "waitFor": "domStable|networkIdle|urlChange",
      "timeoutMs": 8000,
      "confidence": 0.0,
      "risk": "low|medium|high"
    }
  ]
}
```

Execution rules:

- only auto-execute `risk=low` by default (or never auto-execute; MVP: confirm always)
- reject if any step has confidence < 0.6 (configurable)

---

## 7) Interaction & automation (content scripts)

### 7.1 Safe click simulation (snippet)

```js
export async function safeClick(
  selector,
  { expectText, timeoutMs = 8000 } = {},
) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Element not found: ${selector}`);

  if (expectText && !el.textContent?.includes(expectText)) {
    throw new Error(`Verification failed: missing text ${expectText}`);
  }

  el.scrollIntoView({ block: "center" });

  // Dispatch sequence (often more reliable than el.click())
  el.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  // Wait for stabilization
  await waitForDomStable(timeoutMs);
}

export function waitForDomStable(timeoutMs = 2000, quietWindowMs = 250) {
  return new Promise((resolve) => {
    let done = false;
    let lastMut = Date.now();

    const obs = new MutationObserver(() => {
      lastMut = Date.now();
    });

    obs.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
    });

    const tick = () => {
      if (done) return;
      const now = Date.now();
      if (now - lastMut > quietWindowMs) {
        done = true;
        obs.disconnect();
        resolve();
        return;
      }
      if (now - (lastMut - quietWindowMs) > timeoutMs) {
        done = true;
        obs.disconnect();
        resolve(); // best-effort
        return;
      }
      requestAnimationFrame(tick);
    };

    tick();
  });
}
```

### 7.2 Safe input typing (snippet)

```js
export async function safeType(selector, value) {
  const el = document.querySelector(selector);
  if (!el) throw new Error(`Input not found: ${selector}`);

  const tag = el.tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea")
    throw new Error("Not a text input");

  el.focus();
  el.value = "";
  el.dispatchEvent(new Event("input", { bubbles: true }));

  for (const ch of value) {
    el.value += ch;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 20));
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
```

### 7.3 Waiting for SPA navigation

Heuristics:

- detect `location.href` changes
- track history API calls (patch pushState/replaceState)
- wait for DOM stability window
- optional: observe “loading” spinners if present

---

## 8) Model endpoint design

### 8.1 API

`POST /v1/plan`

Request:

```json
{
  "goal": "Find shipping options and show cheapest",
  "page": {
    "url": "https://example.com/product",
    "title": "Product",
    "dom": { "nodes": [] },
    "screenshot": null
  },
  "constraints": ["No purchases", "No form submit"],
  "mode": "suggest"
}
```

Response:

```json
{
  "answer": "Shipping options are...",
  "plan": { "explanation": "...", "actions": [] },
  "confidence": 0.82,
  "risks": ["Selector might vary"],
  "telemetry": { "promptTokens": 0, "completionTokens": 0 }
}
```

### 8.2 Prompt template (planning)

System:

- output must be valid JSON
- prefer semantic selectors
- include verification (expect text/role)
- never propose payment/auth destructive actions

User:

- goal
- compact DOM
- screenshot (optional)

---

## 9) Model evaluation plan

### 9.1 Models to benchmark

Minimum 3-way benchmark:

- **Kimi K2.5** (multimodal agentic)
- **Frontier cloud** (e.g., OpenAI GPT-4o / Anthropic equivalent)
- **Open/local** (Llama 3.x Vision or similar)

### 9.2 Task suite

- 50 pages across categories: e-commerce, docs, SPAs, forms, media, anti-bot
- Each test = { URL, goal, expected result + allowed action boundaries }

### 9.3 Metrics

- Action planning accuracy (human validated) — MVP target ≥ 70%
- Click reliability (executed steps succeed) — target ≥ 85%
- Latency: query → first suggested action (<2s UI; <3–5s plan)
- Safety: 0 unauthorized destructive actions
- Privacy: 0 PII sent when local-only enabled

---

## 10) Prototype plan (MVP)

### 10.1 MVP features

1. Side panel UI: chat + current page URL/title
2. DOM-only page Q&A (read-only)
3. Suggested action plan preview (no auto-run)
4. User-confirmed single-step click
5. Basic safety policy + sensitive-field redaction

### 10.2 Permissions (MVP)

- `sidePanel`, `activeTab`, `scripting`, `storage`
- optional host permissions granted per-site by user

---

## 11) Testing plan

### 11.1 Automated regression

- Use Playwright to open pages
- Inject extension
- Run labeled tasks
- Record: step results + screenshots on failure

### 11.2 Human evaluation

- 20 users × 25 tasks = 500 tasks
- Measures: time-to-completion, satisfaction, perceived safety

### 11.3 Reliability debugging toolkit

- Save per-step trace:
  - selector tried
  - element outerHTML snippet
  - bbox
  - DOM hash before/after

---

## 12) Safety & anti-abuse checklist

**Consent & control**

- Per-site opt-in
- “Suggest mode” default
- “Run” requires click
- Emergency STOP

**Action limits**

- Block payments / checkout / account deletion
- Block form submission by default
- Require confirmation for cross-domain navigation

**Rate limits**

- Cap actions per minute and model calls per origin

**Telemetry**

- Off by default
- Never logs DOM/screenshot raw
- Only aggregated metrics unless user opts in

**Policy compliance**

- MV3 compliant
- No remote code execution
- Clear privacy policy

---

## 13) Implementation roadmap

### MVP → Beta → Production

**MVP (Weeks 1–4)**

- Side panel + message bus
- DOM compactor
- Cloud planner integration
- Preview + single-step click

**Beta (Weeks 5–10)**

- Multi-step execution
- Robust waits/retries
- Screenshot opt-in mode
- Per-site permissions UI
- Benchmarks + reliability harness

**Production (Weeks 11–16)**

- Security audit
- CWS compliance & privacy policy
- Fallback models + local-only mode option
- Analytics (opt-in) + crash reporting

---

## Appendix A: Suggested repo structure

```
extension/
  manifest.json
  background/
    background.js
    policy.js
    api-client.js
  content/
    capture-dom.js
    executor.js
    observe.js
  sidebar/
    index.html
    app.jsx
    styles.css
  shared/
    schema.ts
    selectors.ts
  tests/
    playwright-harness/
server/ (optional)
  api/
  model-router/
  logging/
```

---

## Appendix B: Practical notes

- Prefer **ARIA and role-based targeting** when possible.
- Plan for iframes: content scripts won’t access cross-origin iframe DOM; fallback to guidance.
- Consider a “grounding layer” that maps model-chosen selectors to actual elements and scores matches before execution.

---

**End of document**
