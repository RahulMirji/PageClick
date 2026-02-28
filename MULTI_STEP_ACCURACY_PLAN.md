# 🎯 Multi-Step Task Accuracy Plan

> Making PageClick reliably handle complex, multi-step browser automation tasks like filling multi-page forms, setting up Google OAuth in GCP, enabling APIs, booking flows, etc.

---

## Root Cause Analysis

After auditing the full agent loop, orchestrator, DOM capture, action executor, prompt system, and tool-call pipeline — here are the **7 root causes** of failure on complex multi-step tasks and the **targeted fixes** for each.

---

## Problem 1: Single-Action-Per-Turn = Blind After Navigation

**What happens now:** The model calls ONE tool → we execute it → re-capture the DOM → call the model again. But after a `navigate` or `click` that triggers a page load, we only `waitForPageLoad` for 8s and do a single `capturePage()`. If the new page has a loading spinner, SPA route transition, or lazy-loaded form — we capture a **half-loaded DOM** and the model picks the wrong selector.

### Fix: Smart Page Readiness Detection

| File | Change |
|---|---|
| `action-executor.ts` | Add `waitForDomStable` after every click/input action (not just navigate) — SPAs mutate DOM on click |
| `App.tsx` → `runAgentLoop` | After `executeStep()`, add a 2nd `capturePage()` with retry: if node count < 5 or URL is `about:blank`, wait 1s and retry (max 2 retries) |
| `capture-dom.ts` | Add a `readyState` field to `PageSnapshot` reporting `document.readyState` + any visible spinners/skeleton loaders (check for `[aria-busy="true"]`, `.loading`, `.skeleton` patterns) |

---

## Problem 2: DOM Snapshot Is Too Shallow for Complex Pages

**What happens now:** `captureDOM()` walks the body with `MAX_NODES = 500` and `MAX_TEXT_LENGTH = 120`. GCP Console, booking sites, and multi-step forms easily have 2000+ interactive elements. The model gets a **truncated snapshot** missing the exact button/field it needs.

### Fix: Viewport-Prioritized Capture + Form-Aware Node Budget

| File | Change |
|---|---|
| `capture-dom.ts` | **Phase 1:** Capture all elements in the current viewport first (sorted by `y` position). **Phase 2:** Then add off-screen elements until budget. This ensures the model always sees what's currently visible. |
| `capture-dom.ts` | Increase `MAX_NODES` to `800` but add a **form fast-track**: if a `<form>` is visible, capture ALL its children first (inputs, selects, labels, buttons) regardless of budget, because multi-step forms need every field. |
| `capture-dom.ts` | Add `aria-expanded`, `aria-selected`, `aria-current` to captured attributes — GCP and complex UIs use these to indicate which step/tab is active. |

---

## Problem 3: No "Where Am I?" Awareness in Multi-Step Flows

**What happens now:** The execution prompt gives the model `PREVIOUS ACTIONS` as a flat list. For a 12-step GCP OAuth setup, by step 8 the model has no idea it's on "step 3 of 5" in the wizard — it just sees a wall of ✅/❌ entries and the current DOM. It **repeats actions** or **skips steps**.

### Fix: Step-Tracker with Flow Detection in the Prompt

| File | Change |
|---|---|
| `capture-dom.ts` | Add a `formContext` field to snapshot: detect multi-step indicators like `step 2 of 5`, progress bars (`role="progressbar"`), stepper elements (`.stepper`, `[aria-current="step"]`), active tabs. Return as structured data. |
| `agentPrompt.ts` | Add a `FLOW POSITION` section in the execution prompt: current step indicator text, number of form fields remaining unfilled, list of filled vs empty fields. Gives the model a "GPS" for where it is. |
| `taskOrchestrator.ts` | Add a `flowState` tracker: record the URL + form step indicator at each loop. If the URL hasn't changed in 3 consecutive loops AND no fields changed → emit a "stuck" signal so the prompt adds "Try scrolling or clicking Next." |

---

## Problem 4: Input Fields Get Stale / Wrong React State

**What happens now:** `executeInput()` types character-by-character with 15ms delay. This works for simple inputs but **breaks on**: React controlled components (where `value` is set from state), date pickers, masked inputs (phone, credit card), and autocomplete dropdowns that appear mid-typing.

### Fix: Robust Input with Verification

| File | Change |
|---|---|
| `action-executor.ts` | After typing, **verify** the value: read back `el.value` and compare to intended value. If mismatch, try the `nativeInputValueSetter` approach (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)` + dispatch `input` event). |
| `action-executor.ts` | Add a `select_date` action type (or handle via `eval`) for date pickers — these need special handling (open picker → navigate month → click day). |
| `action-executor.ts` | After input, if an autocomplete dropdown appears (check for `[role="listbox"]` or `[role="combobox"]` popping up within 500ms), wait for it and report in the result so the model knows to click an option next. |
| `toolSchemas.ts` | Add a `clear_first` boolean param to the `input` tool — sometimes you need to NOT clear (e.g., appending to existing text). Default `true` for backward compat. |

---

## Problem 5: 15-Iteration Budget Is Too Low + No Recovery

**What happens now:** `maxLoops = 15`. A GCP OAuth setup or hotel booking easily needs 20-30 steps. When budget runs out, the task dies with "Budget exhausted". No partial credit, no way to continue.

### Fix: Dynamic Budget + Resume Capability

| File | Change |
|---|---|
| `taskOrchestrator.ts` | Make `maxLoops` dynamic based on task complexity. Simple tasks (1-3 steps) → 10. Multi-step forms → 25. Complex flows (booking, setup) → 40. Detect via keyword analysis of the goal. |
| `taskOrchestrator.ts` | When budget is at 80% (e.g., iteration 20/25), inject a warning into the prompt: "You have 5 iterations left. If the task isn't done, call task_complete with a summary of what's done and what's remaining." |
| `App.tsx` | On budget exhaustion, don't just abort — show "I completed X of Y steps. Want me to continue from here?" with a Resume button that restarts the loop with the same goal + history context. |

---

## Problem 6: The Model Doesn't See What Happened After Its Action

**What happens now:** The tool history tells the model `{success: true}` or `{success: false, error: "..."}`. But it doesn't say **what the page looks like now**. The model is guessing blind about the consequences of its action.

### Fix: Post-Action Observation in Tool Result

| File | Change |
|---|---|
| `App.tsx` → after `executeStep()` | After each step, capture a **mini-snapshot** (URL, title, any new modal/dialog/toast, any error banners) and append to the tool result payload: `{success: true, observation: {url: "...", newElements: ["dialog: 'Confirm?'", "toast: 'Saved'"], formProgress: "3/5 fields filled"}}` |
| `capture-dom.ts` | Add a `captureObservation()` function — lightweight version that only grabs: URL, title, visible toasts/modals/alerts (`[role="alert"]`, `[role="dialog"]`, `.toast`, `.snackbar`), and error messages (`.error`, `[aria-invalid="true"]`). |

---

## Problem 7: No Retry/Self-Correction on Failed Selectors

**What happens now:** If the model picks a wrong selector and the click fails, the error goes into history and the model retries — but often picks the **same wrong selector** because nothing in the prompt tells it to try a different approach.

### Fix: Failure-Aware Prompt Injection

| File | Change |
|---|---|
| `agentPrompt.ts` | When the last action failed, add a prominent `⚠️ LAST ACTION FAILED` section with: the error, the selector that failed, and an instruction: "Do NOT retry the same selector. Pick a different element from the Interactive Elements list. If the element isn't visible, try scrolling first." |
| `App.tsx` | Track consecutive failures. After 3 failures on the same action type, auto-inject a `scroll(down)` action to reveal more content, then retry. |

---

## Implementation Priority

| Priority | Fix | Impact | Effort |
|---|---|---|---|
| **P0** | #6 Post-action observation | Highest — model is blind without it | Medium |
| **P0** | #3 Flow position awareness | Highest — model gets lost in wizards | Medium |
| **P1** | #2 Viewport-prioritized DOM capture | High — model misses visible elements | Medium |
| **P1** | #1 Smart page readiness | High — half-loaded DOM = wrong selectors | Low |
| **P1** | #5 Dynamic budget + resume | High — complex tasks die prematurely | Low |
| **P2** | #7 Failure-aware retry | Medium — reduces repeated errors | Low |
| **P2** | #4 Robust input verification | Medium — fixes React/SPA form issues | Medium |

---

## What This Unlocks

After these 7 fixes, PageClick should reliably handle:

- ✅ **Multi-step forms** — "Fill out this 5-page job application" *(flow awareness + form-first capture)*
- ✅ **GCP/AWS console tasks** — "Enable the YouTube Data API" *(viewport capture + post-action observation)*
- ✅ **Booking flows** — "Book a table at 7pm tomorrow" *(dynamic budget + checkpoint at payment)*
- ✅ **Complex SPA navigation** — "Set up Google OAuth in my GCP project" *(smart readiness + retry logic)*

---

## Files Touched (Summary)

| File | Fixes |
|---|---|
| `src/content/capture-dom.ts` | #1, #2, #3, #6 |
| `src/content/action-executor.ts` | #1, #4 |
| `src/sidebar/App.tsx` | #1, #5, #6, #7 |
| `src/sidebar/utils/agentPrompt.ts` | #3, #7 |
| `src/sidebar/utils/taskOrchestrator.ts` | #3, #5 |
| `src/shared/toolSchemas.ts` | #4 |
