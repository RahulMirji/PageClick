/**
 * toolSchemas.ts — Central tool schema registry for PageClick.
 *
 * Defines all browser automation actions as OpenAI-compatible function
 * declarations. Used by the edge function to pass tools[] to each provider,
 * and by the adapter layer to interpret tool_call responses.
 *
 * Supported providers:
 *  - Groq (Llama 4 Scout) — OpenAI-compatible tools[]
 *  - NVIDIA (Kimi K2.5)  — OpenAI-compatible tools[]
 *  - Google (Gemini)     — tools[].functionDeclarations[] via toGeminiTools()
 */

// ── OpenAI-compatible tool types ──────────────────────────────────

export interface OpenAIToolParameter {
    type: string;
    description?: string;
    enum?: string[];
    properties?: Record<string, OpenAIToolParameter>;
    required?: string[];
    items?: OpenAIToolParameter;
}

export interface OpenAITool {
    type: "function";
    function: {
        name: string;
        description: string;
        strict?: boolean;
        parameters: {
            type: "object";
            properties: Record<string, OpenAIToolParameter>;
            required: string[];
            additionalProperties?: boolean;
        };
    };
}

// ── Shared parameter sub-schemas ──────────────────────────────────

const selectorParam: OpenAIToolParameter = {
    type: "string",
    description:
        "CSS selector targeting the element to act on. Prefer #id, [aria-label=...], or [data-testid=...]. Use 'body' for page-level scroll.",
};

const confidenceParam: OpenAIToolParameter = {
    type: "number",
    description:
        "Confidence score from 0.0 to 1.0 that this action will succeed.",
};

const riskParam: OpenAIToolParameter = {
    type: "string",
    enum: ["low", "medium", "high"],
    description:
        "Risk level: low = safe read/navigate, medium = form submit, high = destructive or payment.",
};

const descriptionParam: OpenAIToolParameter = {
    type: "string",
    description: "Human-readable description of what this action does.",
};

const waitForParam: OpenAIToolParameter = {
    type: "string",
    enum: ["domStable", "networkIdle", "urlChange"],
    description:
        "Optional wait strategy after action: domStable (300ms no mutations), networkIdle (DOM + 200ms), urlChange (poll for URL change).",
};

// ── Action tools ──────────────────────────────────────────────────

const clickTool: OpenAITool = {
    type: "function",
    function: {
        name: "click",
        description:
            "Click an element on the page. Dispatches mousedown → mouseup → click events. Works on native buttons, links, checkboxes, radios, and custom ARIA elements. Always prefer this over eval for simple clicks.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: selectorParam,
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
                waitFor: waitForParam,
            },
            required: ["selector", "confidence", "risk", "description", "waitFor"],
            additionalProperties: false,
        },
    },
};

const inputTool: OpenAITool = {
    type: "function",
    function: {
        name: "input",
        description:
            "Type text into an input, textarea, or contentEditable element. Types character-by-character to trigger React/Vue change events. By default, clears existing value first unless clear_first is false.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: selectorParam,
                value: {
                    type: "string",
                    description: "The text to type into the element.",
                },
                clear_first: {
                    type: "boolean",
                    description:
                        "Optional. If true (default), clear existing value before typing. Set false to append to current value.",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
                waitFor: waitForParam,
            },
            required: ["selector", "value", "confidence", "risk", "description", "waitFor"],
            additionalProperties: false,
        },
    },
};

const selectTool: OpenAITool = {
    type: "function",
    function: {
        name: "select",
        description:
            "Select an option from a native <select> dropdown or custom ARIA listbox. Matches by option text or value (case-insensitive, partial match allowed).",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: selectorParam,
                value: {
                    type: "string",
                    description: "The option text or value to select.",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const selectDateTool: OpenAITool = {
    type: "function",
    function: {
        name: "select_date",
        description:
            "Set a date value for date inputs and date-like controls. Use ISO format YYYY-MM-DD in value. Prefer this over generic input when targeting calendars/date pickers.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: selectorParam,
                value: {
                    type: "string",
                    description: "Date value in ISO format YYYY-MM-DD.",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
                waitFor: waitForParam,
            },
            required: ["selector", "value", "confidence", "risk", "description", "waitFor"],
            additionalProperties: false,
        },
    },
};

const scrollTool: OpenAITool = {
    type: "function",
    function: {
        name: "scroll",
        description:
            "Scroll the page or scroll a specific element into view. Use direction='down' to reveal more content, 'top'/'bottom' to jump to page ends. Use selector='body' for whole-page scroll.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: selectorParam,
                value: {
                    type: "string",
                    enum: ["up", "down", "top", "bottom"],
                    description:
                        "Scroll direction. Ignored if selector targets a non-body element (uses scrollIntoView instead).",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const extractTool: OpenAITool = {
    type: "function",
    function: {
        name: "extract",
        description:
            "Read and return the text or value of an element without modifying it. Returns input.value for form fields, textContent for everything else. Use this to observe state before deciding the next action.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: selectorParam,
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const navigateTool: OpenAITool = {
    type: "function",
    function: {
        name: "navigate",
        description:
            "Navigate the browser tab to a new URL. Handled by the background service worker so it works from any page, including restricted chrome:// pages. Always pass a full URL with protocol.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: {
                    type: "string",
                    description:
                        "Leave empty string '' — selector is unused for navigation.",
                },
                value: {
                    type: "string",
                    description:
                        "Full URL to navigate to (e.g. 'https://github.com'). Protocol will be added if missing.",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const evalTool: OpenAITool = {
    type: "function",
    function: {
        name: "eval",
        description:
            "Evaluate a JavaScript expression in the page context via Chrome DevTools Protocol. Used to read React/framework state, compute values, or query DOM properties not exposed via CSS selectors. Result is returned as extractedData. Use sparingly — prefer extract for simple reads.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: {
                    type: "string",
                    description: "Leave empty string '' — not used for eval.",
                },
                value: {
                    type: "string",
                    description:
                        "JavaScript expression to evaluate (e.g. 'document.title' or 'window.__STORE__.user.id'). Must return a serializable value.",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const downloadTool: OpenAITool = {
    type: "function",
    function: {
        name: "download",
        description:
            "Download a file from the page to the user's Downloads folder. Set selector to a CSS selector of a link/image element, OR leave it empty and put a direct URL in value. Never download payment receipts or personal financial data.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: {
                    type: "string",
                    description:
                        "CSS selector for a <a href> or <img src> element. Use empty string if providing a direct URL in value.",
                },
                value: {
                    type: "string",
                    description:
                        "Direct download URL (optional if selector is provided). Overrides selector URL.",
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const tabgroupTool: OpenAITool = {
    type: "function",
    function: {
        name: "tabgroup",
        description:
            "Organize browser tabs into named, color-coded groups using the Chrome Tab Groups API. Three operations: create (make a new group from URL patterns), add (add tabs to existing group), list (return all current groups).",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: {
                    type: "string",
                    description: "Leave empty string '' — not used for tab groups.",
                },
                value: {
                    type: "string",
                    description:
                        'JSON operation object. Examples: create: {"op":"create","title":"Research","color":"blue","urls":["*github.com*"]} | add: {"op":"add","title":"Research","urls":["*docs.google.com*"]} | list: {"op":"list"}. Valid colors: grey,blue,red,yellow,green,pink,purple,cyan,orange.',
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

const nativeTool: OpenAITool = {
    type: "function",
    function: {
        name: "native",
        description:
            "Call a secure native operation on the user's local machine via the PageClick native messaging host. Only 3 ops allowed: clipboard.read, clipboard.write, fs.readText. Never use for passwords, API keys, or payment data.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                selector: {
                    type: "string",
                    description: "Leave empty string '' — not used for native ops.",
                },
                value: {
                    type: "string",
                    description:
                        'JSON payload with op and args. Examples: {"op":"clipboard.read","args":{}} | {"op":"clipboard.write","args":{"text":"Hello"}} | {"op":"fs.readText","args":{"path":"~/Documents/notes.txt"}}',
                },
                confidence: confidenceParam,
                risk: riskParam,
                description: descriptionParam,
            },
            required: ["selector", "value", "confidence", "risk", "description"],
            additionalProperties: false,
        },
    },
};

// ── Control tools (non-action) ────────────────────────────────────

const taskCompleteTool: OpenAITool = {
    type: "function",
    function: {
        name: "task_complete",
        description:
            "Signal that the task has been completed (or cannot be completed). Call this when you have achieved the user's goal, or when you are stuck and cannot make further progress. Do NOT call any other tool in the same turn.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                summary: {
                    type: "string",
                    description:
                        "Short summary of what was accomplished, or why the task could not be completed.",
                },
                nextSteps: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "Optional list of suggested follow-up actions the user can take.",
                },
            },
            required: ["summary", "nextSteps"],
            additionalProperties: false,
        },
    },
};

const checkpointTool: OpenAITool = {
    type: "function",
    function: {
        name: "checkpoint",
        description:
            "Pause the task and ask the user for confirmation before proceeding. Call this when you are about to perform a sensitive or irreversible action such as placing an order, submitting a payment, or deleting data. Do NOT call any other tool in the same turn.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                reason: {
                    type: "string",
                    description:
                        "Short technical reason for the checkpoint (e.g. 'About to place order').",
                },
                message: {
                    type: "string",
                    description:
                        "Human-readable message shown to the user explaining what will happen and asking for approval.",
                },
                canSkip: {
                    type: "boolean",
                    description:
                        "Whether the user can skip this checkpoint and continue automatically.",
                },
            },
            required: ["reason", "message", "canSkip"],
            additionalProperties: false,
        },
    },
};

const askUserTool: OpenAITool = {
    type: "function",
    function: {
        name: "ask_user",
        description:
            "Ask the user a set of clarifying questions when the task is genuinely impossible to proceed without their input. Use sparingly — only when ambiguity cannot be resolved from the current page context. Maximum 3 questions.",
        strict: true,
        parameters: {
            type: "object",
            properties: {
                questions: {
                    type: "array",
                    items: { type: "string" },
                    description:
                        "List of specific questions for the user (max 3). Each question should be answerable in one sentence.",
                },
            },
            required: ["questions"],
            additionalProperties: false,
        },
    },
};

// ── Full tool registry ────────────────────────────────────────────

/** All tools available to the AI during agentic execution. */
export const PAGECLICK_TOOLS: OpenAITool[] = [
    // Action tools (modify the page)
    clickTool,
    inputTool,
    selectTool,
    selectDateTool,
    scrollTool,
    extractTool,
    navigateTool,
    evalTool,
    downloadTool,
    tabgroupTool,
    nativeTool,
    // Control tools (signal state changes)
    taskCompleteTool,
    checkpointTool,
    askUserTool,
];

/**
 * Tools available during the clarification/planning phase only.
 * The AI can only ask questions or declare ready.
 */
export const CLARIFICATION_TOOLS: OpenAITool[] = [
    askUserTool,
    {
        type: "function",
        function: {
            name: "task_ready",
            description:
                "Signal that you have enough information to proceed with the task. Call this immediately if the task is self-evident from the page context. Provide a brief 1-2 sentence summary of what you will do.",
            strict: true,
            parameters: {
                type: "object",
                properties: {
                    summary: {
                        type: "string",
                        description: "Brief plan of what actions you will take.",
                    },
                },
                required: ["summary"],
                additionalProperties: false,
            },
        },
    },
];

// ── Gemini adapter ────────────────────────────────────────────────

export interface GeminiFunctionDeclaration {
    name: string;
    description: string;
    parameters: {
        type: string;
        properties: Record<string, any>;
        required?: string[];
    };
}

/**
 * Converts OpenAI-format tool definitions to Gemini's
 * `tools[].functionDeclarations[]` format.
 *
 * Gemini uses `"STRING"` | `"NUMBER"` | `"BOOLEAN"` (uppercase) instead
 * of JSON Schema `"string"` | `"number"` | `"boolean"`.
 */
export function toGeminiTools(tools: OpenAITool[]): {
    functionDeclarations: GeminiFunctionDeclaration[];
} {
    const functionDeclarations = tools.map((tool) => ({
        name: tool.function.name,
        description: tool.function.description,
        parameters: convertSchemaToGemini(tool.function.parameters),
    }));

    return { functionDeclarations };
}

// Fields that exist in OpenAI schemas but are not supported by Gemini
const GEMINI_STRIP_KEYS = new Set(["strict", "additionalProperties"]);

function convertSchemaToGemini(schema: any): any {
    if (!schema || typeof schema !== "object") return schema;

    const result: any = {};

    for (const [key, value] of Object.entries(schema)) {
        // Strip OpenAI-only fields that Gemini doesn't understand
        if (GEMINI_STRIP_KEYS.has(key)) continue;

        if (key === "type" && typeof value === "string") {
            // Gemini requires uppercase type names
            result[key] = value.toUpperCase();
        } else if (key === "enum" && Array.isArray(value)) {
            // Preserve enum arrays as-is (Gemini supports them natively)
            result[key] = value;
        } else if (key === "properties" && typeof value === "object") {
            result[key] = Object.fromEntries(
                Object.entries(value as Record<string, any>).map(([propKey, propVal]) => [
                    propKey,
                    convertSchemaToGemini(propVal),
                ]),
            );
        } else if (key === "items" && typeof value === "object") {
            result[key] = convertSchemaToGemini(value);
        } else {
            result[key] = value;
        }
    }

    return result;
}
