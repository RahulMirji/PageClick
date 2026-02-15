/**
 * Typed message envelope for communication between
 * Sidebar ↔ Background ↔ Content Script
 */

// --- Message Types ---

export interface CapturePageRequest {
    type: 'CAPTURE_PAGE'
    tabId?: number
}

export interface CapturePageResponse {
    type: 'CAPTURE_PAGE_RESULT'
    payload: PageSnapshot | null
    error?: string
}

export interface HighlightElementRequest {
    type: 'HIGHLIGHT_ELEMENT'
    selector: string
    tabId?: number
}

export interface ClearHighlightRequest {
    type: 'CLEAR_HIGHLIGHT'
    tabId?: number
}

export interface ErrorMessage {
    type: 'ERROR'
    error: string
}

export type ExtensionMessage =
    | CapturePageRequest
    | CapturePageResponse
    | HighlightElementRequest
    | ClearHighlightRequest
    | ExecuteActionRequest
    | ErrorMessage

// --- Action Plan Types (§6) ---

export type ActionType = 'click' | 'input' | 'scroll' | 'extract' | 'navigate'
export type RiskLevel = 'low' | 'medium' | 'high'

export interface ActionStep {
    action: ActionType
    selector: string
    value?: string               // for input actions
    expect?: {
        textIncludes?: string
        role?: string
    }
    waitFor?: 'domStable' | 'networkIdle' | 'urlChange'
    timeoutMs?: number
    confidence: number
    risk: RiskLevel
    description?: string         // human-readable description of this step
}

export interface ActionPlan {
    explanation: string
    actions: ActionStep[]
}

export interface ExecuteActionRequest {
    type: 'EXECUTE_ACTION'
    step: ActionStep
    tabId?: number
}

// --- Page Snapshot Types ---

export interface DOMNode {
    /** Unique integer id assigned during walk */
    id: number
    /** HTML tag name (lowercase) */
    tag: string
    /** Visible text content (trimmed, truncated) */
    text: string
    /** Relevant attributes for grounding */
    attrs: Record<string, string>
    /** Bounding box relative to viewport */
    bbox: { x: number; y: number; width: number; height: number }
    /** CSS selector path for targeting */
    path: string
}

export interface PageSnapshot {
    url: string
    title: string
    description: string
    /** Compact DOM nodes for interactive/semantic elements */
    nodes: DOMNode[]
    /** Plain text excerpt of visible content (fallback) */
    textContent: string
    /** Timestamp of capture */
    capturedAt: number
}
