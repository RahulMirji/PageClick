# PageClick → Claude-Level Extension Roadmap

> **Current Score: 59 / 100** — Target: **80+**
> Last updated: 2026-02-25

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

---

### ❌ Missing Features (Prioritized)

#### 🔴 Priority 1 — Critical (Must Have for Claude Parity)

| # | Feature | Impact | Effort | Why First? |
|---|---------|--------|--------|------------|
| 3 | **Settings / Options Page** | +2 pts | Low | No way to configure API keys, theme, behavior. Quick win — create `options.html` with model selection, clear history, etc. |
| 4 | **Keyboard Shortcuts** | +1 pt | Low | Add `commands` to manifest — `Ctrl+Shift+P` to open panel, `Ctrl+Enter` to send. 10 min fix |

#### 🟡 Priority 2 — Important (Core Intelligence Gap)

| # | Feature | Impact | Effort | Why? |
|---|---------|--------|--------|------|
| 5 | **Artifact Rendering** | +6 pts | High | Claude renders code blocks, documents, SVGs, Mermaid diagrams inline. Build an `<ArtifactViewer>` component with syntax highlighting + copy/download |
| 6 | **Debugger API Integration** | +7 pts | High | Claude uses `chrome.debugger` for network inspection, JS state, console access. Add `debugger` permission + CDP wrapper |
| 7 | **Context Window Management** | +2 pts | Medium | Currently no token counting — will silently fail on long conversations. Add sliding window + token estimation |
| 20 | **Token Usage Display** | +2 pts | Low | Show token count + cost per message in the UI |

#### 🟢 Priority 3 — Nice to Have (Platform Features)

| # | Feature | Impact | Effort | Why? |
|---|---------|--------|--------|------|
| 9 | **Notification System** | +3 pts | Low | Add `notifications` permission. Alert users when background tasks complete |
| 10 | **Download Management** | +3 pts | Medium | Add `downloads` permission. Let AI save files, export conversations, download artifacts |
| 11 | **Project/Context System** | +5 pts | High | Persistent project contexts with custom instructions per website/workflow |
| 12 | **Native Messaging** | +3 pts | High | Communicate with desktop apps — clipboard, file system, local tools |
| 13 | **Tab Group Management** | +2 pts | Medium | Add `tabGroups` permission. Let AI organize research into tab groups |
| 14 | **Incognito Support** | +1 pt | Low | Add `"incognito": "spanning"` to manifest + test |
| 15 | **File URL Access** | +1 pt | Low | Enable `file://` URL access in extension settings |

#### 🔵 Priority 4 — Polish & Production

| # | Feature | Impact | Effort | Why? |
|---|---------|--------|--------|------|
| 16 | **Error Boundaries** | +1 pt | Low | Wrap App in React error boundary — prevent white screen crashes |
| 17 | **Extension Popup** | +1 pt | Low | Quick-access popup for common actions without opening side panel |
| 18 | **Test Coverage** | +2 pts | High | Zero tests currently. Add Vitest for unit tests on safety policy, prompt parsing, orchestrator |
| 19 | **CI/CD Pipeline** | +1 pt | Medium | GitHub Actions for build, lint, test, CRX packaging |

---

## Implementation Order

```
Phase 1 — Foundation (DONE ✅)                → Score: 38 → 59
├── ✅ #1  Conversation Persistence
├── ✅ #2  User Authentication (Google OAuth + Supabase)
├── ✅ #8  Multi-Conversation Support
└── ✅ History UI polish (cards, timestamps, plan/progress persistence)

Phase 2 — Quick Wins + Intelligence (Next)   → Score: 59 → 72
├── #4  Keyboard Shortcuts                     (10 min)
├── #16 Error Boundaries                       (30 min)
├── #14 Incognito + #15 File URLs              (10 min)
├── #3  Settings/Options Page                  (4 hrs)
├── #7  Context Window Management              (4 hrs)
├── #20 Token Usage Display                    (2 hrs)
└── #5  Artifact Rendering                     (10 hrs)

Phase 3 — Deep Integration (Week 3-4)        → Score: 72 → 85
├── #6  Debugger API Integration               (12 hrs)
├── #9  Notification System                    (2 hrs)
├── #10 Download Management                    (4 hrs)
├── #13 Tab Group Management                   (4 hrs)
└── #17 Extension Popup                        (3 hrs)

Phase 4 — Platform & Scale (Week 5-6)        → Score: 85 → 95+
├── #11 Project/Context System                 (12 hrs)
├── #12 Native Messaging                       (8 hrs)
├── #18 Test Coverage                          (10 hrs)
└── #19 CI/CD Pipeline                         (4 hrs)
```

---

> **Phase 1 complete! 🎉 Next up: Phase 2 quick wins to push past 70.**
