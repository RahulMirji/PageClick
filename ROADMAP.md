# PageClick → Claude-Level Extension Roadmap

> **Current Score: 95+ / 100** — Target: **95+ (Achieved)**
> Last updated: 2026-02-28

---

## Feature Checklist

### ✅ Completed Features

- [x] **MV3 Chrome Extension** — Manifest V3 with service worker
- [x] **Side Panel UI** — React 19 sidebar with Vite build
- [x] **Chat Interface** — Markdown rendering, copy/share, thumbs up/down
- [x] **Streaming Responses** — SSE streaming from Supabase edge function
- [x] **DOM Snapshot Capture** — TreeWalker with 500-node limit, visibility checks
- [x] **Sensitive Field Redaction** — Passwords, CC, OTP fields never sent to AI
- [x] **CSS Selector Builder** — Stable selectors via id, aria-label, data-testid, nth-of-type fallback
- [x] **Action Executor** — 6 actions: click, input, scroll, extract, navigate, select
- [x] **React-Compatible Input** — Char-by-char typing with proper event dispatch
- [x] **Wait Strategies** — DOM stable, network idle, URL change detection
- [x] **Visual Feedback** — Green/red flash overlays on action targets
- [x] **Element Highlighting** — Cyan border highlight for targeted elements
- [x] **Background Message Router** — Routes between sidebar ↔ content script
- [x] **Navigation Handler** — Background-level tab navigation with URL normalization
- [x] **Page Load Detection** — Tab status monitoring with timeout fallback
- [x] **Agent Prompt System** — Phase-aware prompts (clarify, execute, info)
- [x] **Task Orchestrator** — State machine: idle → clarifying → executing → observing → checkpoint → completed
- [x] **Multi-step Agent Loop** — Observe → plan → act → re-observe (max 15 iterations)
- [x] **Task Detection** — Regex heuristic for task vs info request classification
- [x] **Safety Policy Engine** — Tiered permissions: auto / confirm / checkpoint / block
- [x] **Selector Blocklist** — Payment, auth, destructive action blocking
- [x] **URL Blocklist** — chrome://, banking, PayPal, Stripe blocked
- [x] **Risk Escalation** — Action + selector combo risk analysis
- [x] **Audit Trail** — chrome.storage-backed log (200 entries max)
- [x] **Checkpoint System** — Pauses before payment/order flows
- [x] **Confirm Dialog** — UI for medium/high risk action approval
- [x] **Plan Confirmation** — Proceed/Cancel before task execution
- [x] **Page Suggestions** — AI-powered (Gemini Nano) + hardcoded fallbacks for 12 site types
- [x] **Page Scan Animation** — Canvas vignette glow with breathing pulse + traveling sweep
- [x] **Image Attachment** — User can attach images in chat
- [x] **Task Progress Card** — Live step-by-step progress (running/completed/failed)
- [x] **Restricted Page Handling** — Graceful fallback for chrome:// and internal pages
- [x] **Abort/Stop** — User can cancel running tasks mid-execution
- [x] **Conversation Persistence** — Supabase DB + chrome.storage.local fallback, full message save/load with history view
- [x] **User Authentication** — Google OAuth via Supabase Auth, AuthGate modal, ProfileView with sign-out, guest mode fallback
- [x] **Multi-Conversation Support** — History tab with date-grouped conversation list, switching, delete, new chat via Home button
- [x] **History UI** — Light grey card layout, timestamps on right side, plan confirm + progress cards persist in history
- [x] **#4 Keyboard Shortcuts** — `Cmd+Shift+P` opens panel (manifest commands), `Cmd+Enter` / `Ctrl+Enter` sends message, ⚙️ Settings in user menu
- [x] **#16 Error Boundary** — `ErrorBoundary.tsx` wraps `<App />` — styled fallback UI on crash, no more blank white screen
- [x] **#14 Incognito Support** — `"incognito": "spanning"` in manifest, works seamlessly in incognito windows
- [x] **#15 File URL Access** — `file://*/*` in `host_permissions`, content script works on local `file://` pages
- [x] **#3 Settings / Options Page** — `options.html` + `OptionsApp.tsx`: model picker, light/dark/system theme toggle, clear history; auto-saves to `chrome.storage.local`
- [x] **#7 Context Window Management** — `tokenUtils.ts` with `trimToContextWindow` (6000-token sliding window) replaces `slice(-10)` in `callModel`
- [x] **#20 Token Usage Display** — `~N tokens` pill badge on every completed assistant message; persisted via `META_PREFIX` encoding so it survives history reload
- [x] **#5 Artifact Rendering** — `ArtifactViewer.tsx` with Prism syntax highlighting for 12+ languages, SVG inline preview, Copy + Download buttons; action buttons now shown on all messages
- [x] **#12 Native Messaging** — Native host bridge (`NATIVE_HOST_CALL`) with approved ops (`clipboard.read`, `clipboard.write`, `fs.readText`), host installer script + local host implementation
- [x] **#18 Test Coverage** — Vitest suite expanded to 22 files / 104 tests (unit + integration + jsdom DOM interaction tests across core runtime and UI flows)
- [x] **#19 CI/CD Pipeline** — GitHub Actions CI on PRs to `dev`: lint, Prettier check, tests, coverage gate + artifact upload, build, production dependency audit

---

### 📌 Priority Track Status

#### 🟡 Priority 2 — Important (Core Intelligence Gap)

| #   | Feature                             | Impact | Effort | Why?                                                                                                                                                 |
| --- | ----------------------------------- | ------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6   | ~~**Debugger API Integration**~~ ✅ | +7 pts | High   | Done — CDP attach/detach lifecycle, Network/Console/Runtime domains, ring buffers, `eval` action type, injected into agent prompt as RUNTIME CONTEXT |

#### 🟢 Priority 3 — Nice to Have (Platform Features)

| #   | Feature                            | Impact | Effort | Why?                                                                                                                       |
| --- | ---------------------------------- | ------ | ------ | -------------------------------------------------------------------------------------------------------------------------- |
| 9   | ~~**Notification System**~~ ✅     | +3 pts | Low    | Done — `notifications` permission, background handler, visibility-gated alerts on task complete/fail                       |
| 10  | ~~**Download Management**~~ ✅     | +3 pts | Medium | Done — `chrome.downloads` for AI-triggered file saves, per-message save button, per-conversation export button             |
| 11  | ~~**Project/Context System**~~ ✅  | +5 pts | High   | Done — Supabase `projects` table, URL auto-matching, custom AI instructions per site, Projects tab with CRUD, Header badge |
| 12  | ~~**Native Messaging**~~ ✅        | +3 pts | High   | Done — end-to-end native host routing + safety-policy constrained local ops                                                 |
| 13  | ~~**Tab Group Management**~~ ✅    | +2 pts | Medium | Done — `tabGroups` permission, AI-driven tab grouping via create/add/list ops, URL pattern matching                        |
| 17  | ~~**Extension Popup**~~ ❌ Skipped | +1 pt  | Low    | Not needed — side panel serves as primary UI, awarded +1 pt for scope decision                                             |

#### 🔵 Priority 4 — Polish & Production

| #   | Feature            | Impact | Effort | Why?                                                                                           |
| --- | ------------------ | ------ | ------ | ---------------------------------------------------------------------------------------------- |
| 18  | ~~**Test Coverage**~~ ✅  | +2 pts | High   | Done — broad Vitest coverage for safety, prompts, orchestrator, stores, background/content routing, DOM component flows |
| 19  | ~~**CI/CD Pipeline**~~ ✅ | +1 pt  | Medium | Done — GitHub Actions gates for lint/format/test/coverage/build/audit on PRs to `dev`                                   |

---

## Implementation Order

```
Phase 1 — Foundation (DONE ✅)                → Score: 38 → 59
├── ✅ #1  Conversation Persistence
├── ✅ #2  User Authentication (Google OAuth + Supabase)
├── ✅ #8  Multi-Conversation Support
└── ✅ History UI polish (cards, timestamps, plan/progress persistence)

Phase 2 — Quick Wins + Intelligence (DONE ✅) → Score: 59 → 72+
├── ✅ #4  Keyboard Shortcuts                  (10 min)
├── ✅ #16 Error Boundaries                    (30 min)
├── ✅ #14 Incognito + #15 File URLs           (10 min)
├── ✅ #3  Settings/Options Page               (4 hrs)
├── ✅ #7  Context Window Management           (4 hrs)
├── ✅ #20 Token Usage Display                 (2 hrs)
└── ✅ #5  Artifact Rendering                  (10 hrs)

Phase 3 — Deep Integration (DONE ✅)          → Score: 72 → 85+
├── ✅ #6  Debugger API Integration               (12 hrs)
├── ✅ #9  Notification System                    (2 hrs)
├── ✅ #10 Download Management                    (4 hrs)
├── ✅ #13 Tab Group Management                   (4 hrs)
└── ❌ #17 Extension Popup — Skipped (+1 pt awarded)

Phase 4 — Platform & Scale (DONE ✅)         → Score: 85 → 95+
├── ✅ #11 Project/Context System                 (12 hrs)
├── ✅ #12 Native Messaging                       (8 hrs)
├── ✅ #18 Test Coverage                          (10 hrs)
└── ✅ #19 CI/CD Pipeline                         (4 hrs)
```

---

> **Phase 4 complete. Score: 95+ achieved. Remaining work is hardening/polish (coverage depth, release packaging, and branch protection).**
