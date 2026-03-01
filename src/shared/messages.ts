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

export interface CaptureObservationRequest {
  type: "CAPTURE_OBSERVATION";
  tabId?: number;
}

export interface PageObservation {
  url: string;
  title: string;
  newElements: string[];
  errorMessages: string[];
  formProgress?: string;
  stepIndicator?: string;
  activeStep?: string;
  filledFields?: number;
  totalFields?: number;
  capturedAt: number;
}

export interface CaptureObservationResponse {
  type: "CAPTURE_OBSERVATION_RESULT";
  payload: PageObservation | null;
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
  | CaptureObservationRequest
  | CaptureObservationResponse
  | HighlightElementRequest
  | ClearHighlightRequest
  | ExecuteActionRequest
  | ErrorMessage;

// --- Action Plan Types (§6) ---

export type ActionType =
  | "click"
  | "input"
  | "select"
  | "select_date"
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
  clearFirst?: boolean; // for input actions, default true
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

// --- Tool History Types (for native tool-calling conversation flow) ---

/**
 * Represents an assistant message that contains a tool call.
 * Used to maintain proper conversation history for the model's
 * agentic fine-tuning: User → Assistant(tool_call) → Tool(result) → Assistant
 */
export interface ToolCallEntry {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

/**
 * A single tool history message — either the assistant's tool call
 * or the tool's result. These are injected into the API message array
 * but never displayed in the chat UI.
 */
export type ToolHistoryMessage =
  | {
    role: "assistant";
    content: string | null;
    tool_calls: ToolCallEntry[];
  }
  | {
    role: "tool";
    tool_call_id: string;
    content: string;
  };

/**
 * Gemini-format tool history messages.
 * Gemini uses role: "model" + functionCall parts and role: "function" + functionResponse parts.
 */
export type GeminiToolHistoryMessage =
  | {
    role: "model";
    parts: Array<{ text?: string; functionCall?: { name: string; args: Record<string, any> } }>;
  }
  | {
    role: "function";
    parts: Array<{ functionResponse: { name: string; response: Record<string, any> } }>;
  };

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

/** Detected multi-step flow context (wizards, forms, steppers) */
export interface FormContext {
  /** Step indicator text like "Step 2 of 5" if found */
  stepIndicator?: string;
  /** Progress bar percentage (0-100) if found */
  progressPercent?: number;
  /** Active tab/step label from stepper or tab bar */
  activeStep?: string;
  /** Total form fields on page */
  totalFields: number;
  /** Number of fields already filled */
  filledFields: number;
  /** List of unfilled field labels/placeholders (up to 10) */
  unfilledFields: string[];
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
  /** document.readyState at capture time */
  readyState?: string;
  /** Whether spinners/skeleton loaders are visible */
  hasLoadingIndicators?: boolean;
  /** Multi-step form/wizard context if detected */
  formContext?: FormContext;
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
