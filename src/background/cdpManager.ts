/// <reference types="chrome" />

/**
 * cdpManager.ts — Chrome DevTools Protocol session manager.
 *
 * Manages attach/detach lifecycle, buffers CDP events into ring buffers,
 * and exposes a snapshot + evalJs API consumed by background.ts handlers.
 *
 * Design decisions:
 *  - Singleton: one instance handles all tabs (extension only runs once)
 *  - Ring buffers: bounded memory, oldest events dropped when full
 *  - No persistence: buffers live only for the task duration (SW may sleep)
 *  - Read-only domains only: Network, Console, Runtime.exceptionThrown
 *    (never Debugger domain — no breakpoints, no source stepping)
 */

import type {
  CDPNetworkEntry,
  CDPConsoleEntry,
  CDPSnapshot,
} from "../shared/messages";

// ── Buffer sizes ──────────────────────────────────────────────────
const MAX_NETWORK = 20;
const MAX_CONSOLE = 30;
const MAX_ERRORS = 10;
const MAX_RESPONSE_BODY = 2000; // chars — never buffer large bodies

// ── Restricted page guard ─────────────────────────────────────────
const RESTRICTED_PREFIXES = [
  "chrome://",
  "chrome-extension://",
  "about:",
  "edge://",
  "brave://",
];
function isRestrictedUrl(url: string): boolean {
  return RESTRICTED_PREFIXES.some((p) => url.startsWith(p));
}

// ── Per-tab session ───────────────────────────────────────────────
interface TabSession {
  tabId: number;
  networkLog: CDPNetworkEntry[];
  consoleLog: CDPConsoleEntry[];
  jsErrors: string[];
  /** Partial entries awaiting response — keyed by CDP requestId */
  pendingRequests: Map<string, CDPNetworkEntry>;
}

function createSession(tabId: number): TabSession {
  return {
    tabId,
    networkLog: [],
    consoleLog: [],
    jsErrors: [],
    pendingRequests: new Map(),
  };
}

// ── Helper: send a CDP command ────────────────────────────────────
function sendCommand(
  tabId: number,
  method: string,
  params: object = {},
): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(result);
      }
    });
  });
}

// ── Ring buffer helpers ───────────────────────────────────────────
function pushCapped<T>(arr: T[], item: T, max: number): void {
  arr.push(item);
  if (arr.length > max) arr.shift();
}

// ── CDPManager class ──────────────────────────────────────────────
class CDPManager {
  private sessions: Map<number, TabSession> = new Map();

  constructor() {
    // Register event listeners once at module level — never remove them
    chrome.debugger.onEvent.addListener(this.onEvent.bind(this));
    chrome.debugger.onDetach.addListener(this.onDetach.bind(this));
  }

  // ── Public API ────────────────────────────────────────────────

  async attach(tabId: number): Promise<{ ok: boolean; error?: string }> {
    // Guard: check active tab URL before attaching
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url && isRestrictedUrl(tab.url)) {
        return { ok: false, error: "Cannot attach to restricted page" };
      }
    } catch {
      return { ok: false, error: "Tab not found" };
    }

    // Guard: already attached to this tab
    if (this.sessions.has(tabId)) {
      return { ok: true }; // idempotent
    }

    try {
      await new Promise<void>((resolve, reject) => {
        chrome.debugger.attach({ tabId }, "1.3", () => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve();
          }
        });
      });
    } catch (err: any) {
      // Most common: "Another debugger is already attached to the tab"
      console.warn("[CDP] Attach failed:", err.message);
      return { ok: false, error: err.message };
    }

    // Create fresh session buffer
    this.sessions.set(tabId, createSession(tabId));

    // Enable CDP domains sequentially
    try {
      // Limit network buffering — we capture bodies ourselves selectively
      await sendCommand(tabId, "Network.enable", {
        maxTotalBufferSize: 0,
        maxResourceBufferSize: 0,
      });
      await sendCommand(tabId, "Console.enable", {});
      await sendCommand(tabId, "Runtime.enable", {});
      console.log("[CDP] Attached to tab", tabId);
      return { ok: true };
    } catch (err: any) {
      // Domain enable failed — detach and report
      await this.detach(tabId);
      return { ok: false, error: `Domain enable failed: ${err.message}` };
    }
  }

  async detach(tabId: number): Promise<void> {
    if (!this.sessions.has(tabId)) return;
    this.sessions.delete(tabId);
    try {
      await new Promise<void>((resolve) => {
        chrome.debugger.detach({ tabId }, () => {
          // Ignore errors — tab may have already navigated/closed
          void chrome.runtime.lastError;
          resolve();
        });
      });
      console.log("[CDP] Detached from tab", tabId);
    } catch {
      // Silently ignore — tab may be gone
    }
  }

  getSnapshot(tabId: number): CDPSnapshot {
    const session = this.sessions.get(tabId);
    if (!session) {
      return {
        attached: false,
        networkLog: [],
        consoleLog: [],
        jsErrors: [],
        capturedAt: Date.now(),
      };
    }
    return {
      attached: true,
      // Reverse so newest-first
      networkLog: [...session.networkLog].reverse(),
      consoleLog: [...session.consoleLog].reverse(),
      jsErrors: [...session.jsErrors].reverse(),
      capturedAt: Date.now(),
    };
  }

  async evalJs(
    tabId: number,
    expression: string,
  ): Promise<{ result?: string; error?: string }> {
    if (!this.sessions.has(tabId)) {
      return { error: "Debugger not attached" };
    }
    try {
      const res = await sendCommand(tabId, "Runtime.evaluate", {
        expression,
        returnByValue: true,
        timeout: 3000,
        silent: true, // don't output to user's console
      });
      if (res?.exceptionDetails) {
        return {
          error: res.exceptionDetails.text || "Eval threw an exception",
        };
      }
      const value = res?.result?.value;
      return {
        result:
          typeof value === "object"
            ? JSON.stringify(value).slice(0, MAX_RESPONSE_BODY)
            : String(value ?? "").slice(0, MAX_RESPONSE_BODY),
      };
    } catch (err: any) {
      return { error: err.message };
    }
  }

  // ── Event handling ────────────────────────────────────────────

  private onEvent(
    source: chrome.debugger.Debuggee,
    method: string,
    params: any,
  ): void {
    const tabId = source.tabId;
    if (!tabId) return;
    const session = this.sessions.get(tabId);
    if (!session) return;

    switch (method) {
      // ── Network ──────────────────────────────────────────
      case "Network.requestWillBeSent": {
        const entry: CDPNetworkEntry = {
          requestId: params.requestId,
          url: params.request?.url ?? "",
          method: params.request?.method ?? "GET",
          timestamp: Date.now(),
        };
        session.pendingRequests.set(params.requestId, entry);
        break;
      }
      case "Network.responseReceived": {
        const pending = session.pendingRequests.get(params.requestId);
        if (!pending) break;
        pending.status = params.response?.status;
        pending.statusText = params.response?.statusText;

        // Selectively fetch response body for JSON responses under ~500KB
        const contentType: string =
          params.response?.headers?.["content-type"] ?? "";
        const encodedDataLength: number =
          params.response?.encodedDataLength ?? Infinity;
        if (contentType.includes("json") && encodedDataLength < 500_000) {
          sendCommand(tabId, "Network.getResponseBody", {
            requestId: params.requestId,
          })
            .then((body: any) => {
              if (pending && body?.body) {
                pending.responseBody = body.body.slice(0, MAX_RESPONSE_BODY);
              }
            })
            .catch(() => {
              if (pending) pending.responseBody = "[body not buffered]";
            });
        }

        // Move from pending to completed log
        session.pendingRequests.delete(params.requestId);
        pushCapped(session.networkLog, pending, MAX_NETWORK);
        break;
      }
      case "Network.loadingFailed": {
        const pending = session.pendingRequests.get(params.requestId);
        if (!pending) break;
        pending.failed = true;
        pending.failureText = params.errorText ?? "Unknown failure";
        session.pendingRequests.delete(params.requestId);
        pushCapped(session.networkLog, pending, MAX_NETWORK);
        break;
      }

      // ── Console ──────────────────────────────────────────
      case "Console.messageAdded": {
        const msg = params.message;
        const entry: CDPConsoleEntry = {
          level: msg.level ?? "log",
          text: String(msg.text ?? "").slice(0, 500),
          timestamp: Date.now(),
          source: msg.source,
          lineNumber: msg.line,
        };
        pushCapped(session.consoleLog, entry, MAX_CONSOLE);
        break;
      }

      // ── Runtime exceptions ────────────────────────────────
      case "Runtime.exceptionThrown": {
        const detail = params.exceptionDetails;
        const text =
          detail?.exception?.description ?? detail?.text ?? "Unknown JS error";
        pushCapped(session.jsErrors, text.slice(0, 300), MAX_ERRORS);
        break;
      }
    }
  }

  private onDetach(source: chrome.debugger.Debuggee, reason: string): void {
    const tabId = source.tabId;
    if (!tabId) return;
    console.log("[CDP] Detached from tab", tabId, "reason:", reason);
    // Clean up session; background will re-attach on next task start if needed
    this.sessions.delete(tabId);
  }
}

// ── Export singleton ──────────────────────────────────────────────
export const cdpManager = new CDPManager();
