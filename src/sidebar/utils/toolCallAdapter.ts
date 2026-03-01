/**
 * toolCallAdapter.ts — Translates raw model tool_call responses into
 * PageClick's internal ActionPlan / CheckpointBlock / TaskCompleteBlock types.
 *
 * Supports two response formats:
 *  - OpenAI-compatible (Groq, NVIDIA/Kimi) — choices[0].message.tool_calls[]
 *  - Gemini native       — candidates[0].content.parts[].functionCall
 *
 * Zero regex, zero JSON repair. The model API guarantees valid structure.
 */

import type {
    ActionStep,
    ActionType,
    RiskLevel,
    ActionPlan,
    CheckpointBlock,
    TaskCompleteBlock,
    AskUserBlock,
    ToolHistoryMessage,
    GeminiToolHistoryMessage,
    PageObservation,
} from "../../shared/messages";

// ── Result types ───────────────────────────────────────────────────

export type ParsedToolResult =
    | { type: "action"; plan: ActionPlan }
    | { type: "checkpoint"; block: CheckpointBlock }
    | { type: "complete"; block: TaskCompleteBlock }
    | { type: "ask_user"; block: AskUserBlock }
    | { type: "task_ready"; summary: string }
    | { type: "error"; error: string };

// ── Valid action tool names ────────────────────────────────────────

const ACTION_TOOL_NAMES = new Set<string>([
    "click",
    "input",
    "select",
    "select_date",
    "scroll",
    "extract",
    "navigate",
    "eval",
    "download",
    "tabgroup",
    "native",
]);

// ── Argument normalizer ───────────────────────────────────────────

/**
 * Converts the raw tool arguments object into a typed ActionStep.
 * Applies defensive defaults for optional fields.
 */
function argsToActionStep(
    toolName: string,
    args: Record<string, any>,
): ActionStep {
    return {
        action: toolName as ActionType,
        selector: typeof args.selector === "string" ? args.selector : "",
        value: typeof args.value === "string" ? args.value : undefined,
        clearFirst:
            typeof args.clear_first === "boolean"
                ? args.clear_first
                : typeof args.clearFirst === "boolean"
                    ? args.clearFirst
                    : undefined,
        confidence:
            typeof args.confidence === "number"
                ? Math.max(0, Math.min(1, args.confidence))
                : 0.8,
        risk: (["low", "medium", "high"].includes(args.risk)
            ? args.risk
            : "low") as RiskLevel,
        description:
            typeof args.description === "string" ? args.description : undefined,
        waitFor:
            args.waitFor === "domStable" ||
                args.waitFor === "networkIdle" ||
                args.waitFor === "urlChange"
                ? args.waitFor
                : undefined,
        timeoutMs: typeof args.timeoutMs === "number" ? args.timeoutMs : undefined,
    };
}

// ── OpenAI-compatible adapter (Groq + NVIDIA/Kimi) ────────────────

/**
 * Parses an OpenAI-style non-streaming chat completion response.
 *
 * Expected shape:
 * {
 *   choices: [{
 *     message: {
 *       role: "assistant",
 *       content: string | null,
 *       tool_calls?: [{
 *         id: string,
 *         type: "function",
 *         function: { name: string, arguments: string }
 *       }]
 *     },
 *     finish_reason: "tool_calls" | "stop" | ...
 *   }]
 * }
 */
export function parseOpenAIToolCall(response: any): ParsedToolResult {
    const message = response?.choices?.[0]?.message;
    if (!message) {
        return { type: "error", error: "No message in response" };
    }

    const toolCalls = message.tool_calls;

    // No tool calls — model responded with plain text (shouldn't happen in tool mode)
    if (!toolCalls || toolCalls.length === 0) {
        const text = message.content || "";
        console.warn("[ToolCallAdapter] No tool_calls in response. Content:", text.slice(0, 200));
        return {
            type: "error",
            error: "Model did not return a tool call. Content: " + text.slice(0, 100),
        };
    }

    // Take the first tool call (we request single-step actions)
    const toolCall = toolCalls[0];
    const name: string = toolCall?.function?.name || "";

    let args: Record<string, any> = {};
    try {
        args = JSON.parse(toolCall.function.arguments || "{}");
    } catch {
        return { type: "error", error: `Failed to parse tool arguments for "${name}"` };
    }

    return dispatchTool(name, args, message.content || "");
}

// ── Gemini adapter ────────────────────────────────────────────────

/**
 * Parses a Gemini generateContent (non-streaming) response.
 *
 * Expected shape:
 * {
 *   candidates: [{
 *     content: {
 *       parts: [
 *         { functionCall: { name: string, args: object } }
 *         -- OR --
 *         { text: string }
 *       ]
 *     }
 *   }]
 * }
 */
export function parseGeminiToolCall(response: any): ParsedToolResult {
    const parts = response?.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts) || parts.length === 0) {
        return { type: "error", error: "No content parts in Gemini response" };
    }

    // Find the first functionCall part
    const fnPart = parts.find((p: any) => p.functionCall);
    if (!fnPart) {
        // Check for plain text (info-only response leaked into tool mode?)
        const textPart = parts.find((p: any) => p.text);
        console.warn("[ToolCallAdapter] No functionCall in Gemini response. Text:", textPart?.text?.slice(0, 200));
        return {
            type: "error",
            error: "Gemini did not return a function call.",
        };
    }

    const name: string = fnPart.functionCall.name || "";
    const args: Record<string, any> = fnPart.functionCall.args || {};

    // Gemini passes explanation as text part before the function call
    const explanationPart = parts.find((p: any) => p.text && !p.functionCall);
    const explanation: string = explanationPart?.text || "";

    return dispatchTool(name, args, explanation);
}

// ── Tool dispatcher ───────────────────────────────────────────────

/**
 * Routes a parsed tool call to the correct result type.
 * @param name       Tool name from the model
 * @param args       Parsed arguments object
 * @param explanation Text explanation the model may have included
 */
function dispatchTool(
    name: string,
    args: Record<string, any>,
    explanation: string,
): ParsedToolResult {
    // ── Action tools ──
    if (ACTION_TOOL_NAMES.has(name)) {
        const step = argsToActionStep(name, args);
        return {
            type: "action",
            plan: {
                explanation: explanation || args.description || `Executing ${name}`,
                actions: [step],
            },
        };
    }

    // ── Control tools ──
    switch (name) {
        case "task_complete":
            return {
                type: "complete",
                block: {
                    summary: args.summary || "Task completed.",
                    nextSteps: Array.isArray(args.nextSteps) ? args.nextSteps : [],
                },
            };

        case "checkpoint":
            return {
                type: "checkpoint",
                block: {
                    reason: args.reason || "Sensitive action ahead",
                    message:
                        args.message ||
                        "I'm about to perform a sensitive action. Do you want to continue?",
                    canSkip: typeof args.canSkip === "boolean" ? args.canSkip : false,
                },
            };

        case "ask_user":
            return {
                type: "ask_user",
                block: {
                    questions: Array.isArray(args.questions) ? args.questions : [],
                },
            };

        case "task_ready":
            return {
                type: "task_ready",
                summary: args.summary || "Ready to proceed.",
            };

        default:
            return {
                type: "error",
                error: `Unknown tool name: "${name}". Expected one of: click, input, select, select_date, scroll, extract, navigate, eval, download, tabgroup, native, task_complete, checkpoint, ask_user, task_ready.`,
            };
    }
}

// ── Provider detection helper ─────────────────────────────────────

/**
 * Detects the provider from the model key and routes to the correct adapter.
 * @param modelKey  Model key from the edge function config (e.g. "gemini-3-pro", "llama-4-scout")
 * @param response  Raw JSON response body from the API
 */
export function parseToolCallResponse(
    modelKey: string,
    response: any,
): ParsedToolResult {
    if (modelKey.startsWith("gemini")) {
        return parseGeminiToolCall(response);
    }
    return parseOpenAIToolCall(response);
}

// ── Tool history extraction ───────────────────────────────────────

/**
 * Extracts the raw assistant tool-call message and builds the
 * corresponding tool-result message from the execution outcome.
 *
 * These two messages form the proper conversation history that LLMs
 * expect for multi-turn tool calling:
 *   User → Assistant(tool_call) → Tool(result) → Assistant(next tool_call) → ...
 *
 * Without this, the model "forgets" it ever called a tool and may
 * hallucinate or repeat actions.
 *
 * @param modelKey   "gemini-3-pro" | "llama-4-scout" | etc.
 * @param rawResponse Raw API JSON from the provider
 * @param toolResult  The execution result to feed back as tool output
 * @returns Array of 2 messages: [assistantToolCall, toolResult], or empty if extraction fails
 */
export function extractToolHistoryMessages(
    modelKey: string,
    rawResponse: any,
    toolResult: {
        success: boolean;
        extractedData?: string;
        error?: string;
        observation?: PageObservation;
    },
): (ToolHistoryMessage | GeminiToolHistoryMessage)[] {
    const resultPayload = JSON.stringify({
        success: toolResult.success,
        ...(toolResult.extractedData ? { data: toolResult.extractedData } : {}),
        ...(toolResult.error ? { error: toolResult.error } : {}),
        ...(toolResult.observation ? { observation: toolResult.observation } : {}),
    });

    if (modelKey.startsWith("gemini")) {
        return extractGeminiToolHistory(rawResponse, resultPayload);
    }
    return extractOpenAIToolHistory(rawResponse, resultPayload);
}

/**
 * Extracts tool history for OpenAI-compatible providers (Groq, NVIDIA).
 */
function extractOpenAIToolHistory(
    rawResponse: any,
    resultPayload: string,
): ToolHistoryMessage[] {
    const message = rawResponse?.choices?.[0]?.message;
    if (!message?.tool_calls?.[0]) return [];

    const toolCall = message.tool_calls[0];
    const toolCallId = toolCall.id || `call_${Date.now()}`;

    return [
        {
            role: "assistant",
            content: message.content || null,
            tool_calls: [
                {
                    id: toolCallId,
                    type: "function",
                    function: {
                        name: toolCall.function.name,
                        arguments: toolCall.function.arguments || "{}",
                    },
                },
            ],
        },
        {
            role: "tool",
            tool_call_id: toolCallId,
            content: resultPayload,
        },
    ];
}

/**
 * Extracts tool history for Gemini provider.
 * Gemini uses: role="model" with functionCall parts, role="function" with functionResponse parts.
 */
function extractGeminiToolHistory(
    rawResponse: any,
    resultPayload: string,
): GeminiToolHistoryMessage[] {
    const parts = rawResponse?.candidates?.[0]?.content?.parts;
    if (!parts || !Array.isArray(parts)) return [];

    const fnPart = parts.find((p: any) => p.functionCall);
    if (!fnPart) return [];

    const fnName = fnPart.functionCall.name || "";
    const fnArgs = fnPart.functionCall.args || {};

    // Collect text parts that came before the function call (chain-of-thought)
    const modelParts: any[] = [];
    for (const p of parts) {
        if (p.text) modelParts.push({ text: p.text });
        if (p.functionCall) {
            modelParts.push({ functionCall: { name: fnName, args: fnArgs } });
            break;
        }
    }

    let parsedResult: Record<string, any>;
    try {
        parsedResult = JSON.parse(resultPayload);
    } catch {
        parsedResult = { result: resultPayload };
    }

    return [
        {
            role: "model",
            parts: modelParts,
        },
        {
            role: "function",
            parts: [
                {
                    functionResponse: {
                        name: fnName,
                        response: parsedResult,
                    },
                },
            ],
        },
    ];
}
