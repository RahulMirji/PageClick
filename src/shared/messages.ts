/**
 * Typed message envelope for communication between
 * Sidebar ↔ Background ↔ Content Script
 */

// --- Message Types ---

export interface CapturePageRequest {
  type: "CAPTURE_PAGE";
  tabId?: number;
}

export interface CapturePageResponse {
  type: "CAPTURE_PAGE_RESULT";
  payload: PageSnapshot | null;
  error?: string;
}

export interface HighlightElementRequest {
  type: "HIGHLIGHT_ELEMENT";
  selector: string;
  tabId?: number;
}

export interface ClearHighlightRequest {
  type: "CLEAR_HIGHLIGHT";
  tabId?: number;
}

export interface ErrorMessage {
  type: "ERROR";
  error: string;
}

export type ExtensionMessage =
  | CapturePageRequest
  | CapturePageResponse
  | HighlightElementRequest
  | ClearHighlightRequest
  | ExecuteActionRequest
  | ErrorMessage;

// --- Action Plan Types (§6) ---

export type ActionType =
  | "click"
  | "input"
  | "select"
  | "scroll"
  | "extract"
  | "navigate"
  | "eval"
  | "download"
  | "tabgroup"
  | "native";
export type RiskLevel = "low" | "medium" | "high";

export interface ActionStep {
  action: ActionType;
  selector: string;
  value?: string; // for input actions
  expect?: {
    textIncludes?: string;
    role?: string;
  };
  waitFor?: "domStable" | "networkIdle" | "urlChange";
  timeoutMs?: number;
  confidence: number;
  risk: RiskLevel;
  description?: string; // human-readable description of this step
}

export interface ActionPlan {
  explanation: string;
  actions: ActionStep[];
}

export interface ExecuteActionRequest {
  type: "EXECUTE_ACTION";
  step: ActionStep;
  tabId?: number;
}

export interface WaitForPageLoadRequest {
  type: "WAIT_FOR_PAGE_LOAD";
  timeoutMs?: number;
}

export interface WaitForPageLoadResponse {
  type: "WAIT_FOR_PAGE_LOAD_RESULT";
  success: boolean;
  url?: string;
  error?: string;
}

// --- Agentic Response Block Types ---

export type TaskPhase =
  | "idle"
  | "clarifying"
  | "executing"
  | "observing"
  | "checkpoint"
  | "completed"
  | "error";

export interface AskUserBlock {
  questions: string[];
}

export interface CheckpointBlock {
  reason: string;
  message: string;
  canSkip: boolean;
}

export interface TaskCompleteBlock {
  summary: string;
  nextSteps: string[];
}

// --- Page Snapshot Types ---

export interface DOMNode {
  /** Unique integer id assigned during walk */
  id: number;
  /** HTML tag name (lowercase) */
  tag: string;
  /** Visible text content (trimmed, truncated) */
  text: string;
  /** Relevant attributes for grounding */
  attrs: Record<string, string>;
  /** Bounding box relative to viewport */
  bbox: { x: number; y: number; width: number; height: number };
  /** CSS selector path for targeting */
  path: string;
}

export interface PageSnapshot {
  url: string;
  title: string;
  description: string;
  /** Compact DOM nodes for interactive/semantic elements */
  nodes: DOMNode[];
  /** Plain text excerpt of visible content (fallback) */
  textContent: string;
  /** Timestamp of capture */
  capturedAt: number;
}

// --- CDP (Chrome DevTools Protocol) Types ---

/** A single captured network request/response pair */
export interface CDPNetworkEntry {
  requestId: string;
  url: string;
  method: string;
  status?: number;
  statusText?: string;
  /** Response body truncated to 2000 chars — never store full bodies */
  responseBody?: string;
  timestamp: number;
  failed?: boolean;
  failureText?: string;
}

/** A single console message captured via CDP */
export interface CDPConsoleEntry {
  level: "log" | "warn" | "error" | "info" | "debug";
  text: string;
  timestamp: number;
  source?: string;
  lineNumber?: number;
}

/** Full CDP context snapshot returned to sidebar on each loop iteration */
export interface CDPSnapshot {
  /** Whether the debugger is currently attached to this tab */
  attached: boolean;
  /** Last 20 network requests, newest first */
  networkLog: CDPNetworkEntry[];
  /** Last 30 console messages */
  consoleLog: CDPConsoleEntry[];
  /** Last 10 uncaught JS errors (from Runtime.exceptionThrown) */
  jsErrors: string[];
  capturedAt: number;
}
