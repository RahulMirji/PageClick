/**
 * toolCallAdapter.test.ts
 * Unit tests for the provider adapter layer.
 *
 * Tests both OpenAI-compatible and Gemini response formats.
 */

import { describe, it, expect } from "vitest";
import {
    parseOpenAIToolCall,
    parseGeminiToolCall,
    parseToolCallResponse,
    extractToolHistoryMessages,
} from "../src/sidebar/utils/toolCallAdapter";

// ── Fixture builders ───────────────────────────────────────────────

function makeOpenAIResponse(name: string, args: object, content = "") {
    return {
        choices: [
            {
                message: {
                    role: "assistant",
                    content,
                    tool_calls: [
                        {
                            id: "call_abc123",
                            type: "function",
                            function: {
                                name,
                                arguments: JSON.stringify(args),
                            },
                        },
                    ],
                },
                finish_reason: "tool_calls",
            },
        ],
    };
}

function makeGeminiResponse(name: string, args: object, textBefore = "") {
    return {
        candidates: [
            {
                content: {
                    parts: [
                        ...(textBefore ? [{ text: textBefore }] : []),
                        { functionCall: { name, args } },
                    ],
                },
            },
        ],
    };
}

// ── OpenAI adapter tests ──────────────────────────────────────────

describe("parseOpenAIToolCall — action tools", () => {
    it("parses a click tool call", () => {
        const resp = makeOpenAIResponse("click", {
            selector: "#submit-btn",
            confidence: 0.97,
            risk: "low",
            description: "Click submit button",
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("action");
        if (result.type === "action") {
            expect(result.plan.actions[0].action).toBe("click");
            expect(result.plan.actions[0].selector).toBe("#submit-btn");
            expect(result.plan.actions[0].confidence).toBe(0.97);
        }
    });

    it("parses an input tool call", () => {
        const resp = makeOpenAIResponse("input", {
            selector: "#search-box",
            value: "hello world",
            confidence: 0.95,
            risk: "low",
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("action");
        if (result.type === "action") {
            expect(result.plan.actions[0].action).toBe("input");
            expect(result.plan.actions[0].value).toBe("hello world");
        }
    });

    it("parses a navigate tool call", () => {
        const resp = makeOpenAIResponse("navigate", {
            value: "https://example.com",
            confidence: 0.99,
            risk: "low",
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("action");
        if (result.type === "action") {
            expect(result.plan.actions[0].action).toBe("navigate");
            expect(result.plan.actions[0].value).toBe("https://example.com");
        }
    });

    it("clamps confidence to 0-1 range", () => {
        const resp = makeOpenAIResponse("click", {
            selector: "button",
            confidence: 1.5, // over 1 — should clamp to 1
            risk: "low",
        });
        const result = parseOpenAIToolCall(resp);
        if (result.type === "action") {
            expect(result.plan.actions[0].confidence).toBe(1);
        }
    });

    it("defaults risk to 'low' for unknown values", () => {
        const resp = makeOpenAIResponse("click", {
            selector: "button",
            confidence: 0.9,
            risk: "extreme", // invalid
        });
        const result = parseOpenAIToolCall(resp);
        if (result.type === "action") {
            expect(result.plan.actions[0].risk).toBe("low");
        }
    });
});

describe("parseOpenAIToolCall — control tools", () => {
    it("parses task_complete", () => {
        const resp = makeOpenAIResponse("task_complete", {
            summary: "Submitted the form successfully.",
            nextSteps: ["Check your inbox"],
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("complete");
        if (result.type === "complete") {
            expect(result.block.summary).toBe("Submitted the form successfully.");
            expect(result.block.nextSteps).toEqual(["Check your inbox"]);
        }
    });

    it("parses checkpoint", () => {
        const resp = makeOpenAIResponse("checkpoint", {
            reason: "About to enter payment page",
            message: "Should I continue to checkout?",
            canSkip: false,
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("checkpoint");
        if (result.type === "checkpoint") {
            expect(result.block.reason).toBe("About to enter payment page");
            expect(result.block.canSkip).toBe(false);
        }
    });

    it("parses ask_user", () => {
        const resp = makeOpenAIResponse("ask_user", {
            questions: ["Which account should I use?", "Any date preference?"],
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("ask_user");
        if (result.type === "ask_user") {
            expect(result.block.questions.length).toBe(2);
        }
    });

    it("parses task_ready", () => {
        const resp = makeOpenAIResponse("task_ready", {
            summary: "I will navigate to Gmail and search for your email.",
        });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("task_ready");
        if (result.type === "task_ready") {
            expect(result.summary).toContain("Gmail");
        }
    });
});

describe("parseOpenAIToolCall — error cases", () => {
    it("returns error when no tool_calls in response", () => {
        const resp = {
            choices: [{ message: { role: "assistant", content: "Just text" } }],
        };
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("error");
    });

    it("returns error when response is completely empty", () => {
        const result = parseOpenAIToolCall({});
        expect(result.type).toBe("error");
    });

    it("returns error for unknown tool name", () => {
        const resp = makeOpenAIResponse("unknown_tool_xyz", { foo: "bar" });
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("error");
    });

    it("returns error when arguments JSON is malformed", () => {
        const resp = {
            choices: [
                {
                    message: {
                        tool_calls: [
                            {
                                function: {
                                    name: "click",
                                    arguments: "{ invalid json }}}",
                                },
                            },
                        ],
                    },
                },
            ],
        };
        const result = parseOpenAIToolCall(resp);
        expect(result.type).toBe("error");
    });
});

// ── Gemini adapter tests ──────────────────────────────────────────

describe("parseGeminiToolCall — action tools", () => {
    it("parses a click function call", () => {
        const resp = makeGeminiResponse("click", {
            selector: ".login-btn",
            confidence: 0.95,
            risk: "low",
        });
        const result = parseGeminiToolCall(resp);
        expect(result.type).toBe("action");
        if (result.type === "action") {
            expect(result.plan.actions[0].action).toBe("click");
            expect(result.plan.actions[0].selector).toBe(".login-btn");
        }
    });

    it("parses a scroll function call", () => {
        const resp = makeGeminiResponse("scroll", {
            selector: "window",
            value: "down",
            confidence: 0.9,
            risk: "low",
        });
        const result = parseGeminiToolCall(resp);
        expect(result.type).toBe("action");
        if (result.type === "action") {
            expect(result.plan.actions[0].action).toBe("scroll");
        }
    });

    it("uses text part before functionCall as explanation", () => {
        const resp = makeGeminiResponse(
            "click",
            { selector: "#btn", confidence: 0.9, risk: "low" },
            "I will click the submit button.",
        );
        const result = parseGeminiToolCall(resp);
        if (result.type === "action") {
            expect(result.plan.explanation).toContain("click the submit button");
        }
    });
});

describe("parseGeminiToolCall — control tools", () => {
    it("parses task_complete", () => {
        const resp = makeGeminiResponse("task_complete", {
            summary: "Done!",
            nextSteps: [],
        });
        const result = parseGeminiToolCall(resp);
        expect(result.type).toBe("complete");
    });

    it("parses checkpoint", () => {
        const resp = makeGeminiResponse("checkpoint", {
            reason: "Payment page",
            message: "Continue?",
            canSkip: true,
        });
        const result = parseGeminiToolCall(resp);
        expect(result.type).toBe("checkpoint");
        if (result.type === "checkpoint") {
            expect(result.block.canSkip).toBe(true);
        }
    });
});

describe("parseGeminiToolCall — error cases", () => {
    it("returns error when no functionCall part", () => {
        const resp = {
            candidates: [{ content: { parts: [{ text: "Just text answer" }] } }],
        };
        const result = parseGeminiToolCall(resp);
        expect(result.type).toBe("error");
    });

    it("returns error when candidates is empty", () => {
        const result = parseGeminiToolCall({ candidates: [] });
        expect(result.type).toBe("error");
    });
});

// ── Provider routing ──────────────────────────────────────────────

describe("parseToolCallResponse — provider routing", () => {
    it("routes gemini-3-pro to Gemini adapter", () => {
        const geminiResp = makeGeminiResponse("click", {
            selector: "#btn",
            confidence: 0.9,
            risk: "low",
        });
        const result = parseToolCallResponse("gemini-3-pro", geminiResp);
        expect(result.type).toBe("action");
    });

    it("routes llama-4-scout to OpenAI adapter", () => {
        const openaiResp = makeOpenAIResponse("navigate", {
            value: "https://example.com",
            confidence: 0.95,
            risk: "low",
        });
        const result = parseToolCallResponse("llama-4-scout", openaiResp);
        expect(result.type).toBe("action");
    });

    it("routes deepseek-r1 to OpenAI adapter", () => {
        const openaiResp = makeOpenAIResponse("task_complete", {
            summary: "All done!",
            nextSteps: [],
        });
        const result = parseToolCallResponse("qwen3-32b", openaiResp);
        expect(result.type).toBe("complete");
    });
});

// ── extractToolHistoryMessages — OpenAI format ────────────────────

describe("extractToolHistoryMessages — OpenAI format", () => {
    it("returns assistant + tool message pair for a click action", () => {
        const rawResponse = makeOpenAIResponse("click", {
            selector: "#btn",
            confidence: 0.9,
            risk: "low",
        });
        const result = extractToolHistoryMessages("llama-4-scout", rawResponse, {
            success: true,
        });
        expect(result).toHaveLength(2);

        const assistantMsg = result[0] as any;
        expect(assistantMsg.role).toBe("assistant");
        expect(assistantMsg.tool_calls).toHaveLength(1);
        expect(assistantMsg.tool_calls[0].function.name).toBe("click");
        expect(assistantMsg.tool_calls[0].id).toBe("call_abc123");

        const toolMsg = result[1] as any;
        expect(toolMsg.role).toBe("tool");
        expect(toolMsg.tool_call_id).toBe("call_abc123");
        expect(JSON.parse(toolMsg.content)).toMatchObject({ success: true });
    });

    it("includes error in tool result when step failed", () => {
        const rawResponse = makeOpenAIResponse("input", {
            selector: "#field",
            value: "test",
            confidence: 0.8,
            risk: "low",
        });
        const result = extractToolHistoryMessages("llama-4-scout", rawResponse, {
            success: false,
            error: "Element not found",
        });
        const toolMsg = result[1] as any;
        const content = JSON.parse(toolMsg.content);
        expect(content.success).toBe(false);
        expect(content.error).toBe("Element not found");
    });

    it("includes extractedData in tool result when present", () => {
        const rawResponse = makeOpenAIResponse("extract", {
            selector: ".price",
            value: "text",
            confidence: 0.95,
            risk: "low",
        });
        const result = extractToolHistoryMessages("qwen3-32b", rawResponse, {
            success: true,
            extractedData: "$29.99",
        });
        const toolMsg = result[1] as any;
        const content = JSON.parse(toolMsg.content);
        expect(content.data).toBe("$29.99");
    });

    it("preserves assistant content (chain-of-thought text)", () => {
        const rawResponse = makeOpenAIResponse(
            "click",
            { selector: "#next", confidence: 0.9, risk: "low" },
            "I see the Next button, I will click it.",
        );
        const result = extractToolHistoryMessages("llama-4-scout", rawResponse, {
            success: true,
        });
        const assistantMsg = result[0] as any;
        expect(assistantMsg.content).toBe("I see the Next button, I will click it.");
    });

    it("returns empty array when no tool_calls present", () => {
        const rawResponse = {
            choices: [{ message: { role: "assistant", content: "Just text" } }],
        };
        const result = extractToolHistoryMessages("llama-4-scout", rawResponse, {
            success: true,
        });
        expect(result).toHaveLength(0);
    });

    it("generates a fallback tool_call_id when none in response", () => {
        const rawResponse = {
            choices: [
                {
                    message: {
                        tool_calls: [
                            {
                                // no id field
                                function: {
                                    name: "click",
                                    arguments: '{"selector": "a"}',
                                },
                            },
                        ],
                    },
                },
            ],
        };
        const result = extractToolHistoryMessages("llama-4-scout", rawResponse, {
            success: true,
        });
        expect(result).toHaveLength(2);
        const assistantMsg = result[0] as any;
        const toolMsg = result[1] as any;
        expect(assistantMsg.tool_calls[0].id).toMatch(/^call_/);
        expect(toolMsg.tool_call_id).toBe(assistantMsg.tool_calls[0].id);
    });
});

// ── extractToolHistoryMessages — Gemini format ────────────────────

describe("extractToolHistoryMessages — Gemini format", () => {
    it("returns model + function message pair for a click action", () => {
        const rawResponse = makeGeminiResponse("click", {
            selector: ".login-btn",
            confidence: 0.95,
            risk: "low",
        });
        const result = extractToolHistoryMessages("gemini-3-pro", rawResponse, {
            success: true,
        });
        expect(result).toHaveLength(2);

        const modelMsg = result[0] as any;
        expect(modelMsg.role).toBe("model");
        expect(modelMsg.parts.some((p: any) => p.functionCall?.name === "click")).toBe(true);

        const fnMsg = result[1] as any;
        expect(fnMsg.role).toBe("function");
        expect(fnMsg.parts[0].functionResponse.name).toBe("click");
        expect(fnMsg.parts[0].functionResponse.response).toMatchObject({ success: true });
    });

    it("preserves chain-of-thought text parts before functionCall", () => {
        const rawResponse = makeGeminiResponse(
            "navigate",
            { value: "https://example.com", confidence: 0.99, risk: "low" },
            "I need to navigate to the target page.",
        );
        const result = extractToolHistoryMessages("gemini-3-pro", rawResponse, {
            success: true,
        });
        const modelMsg = result[0] as any;
        expect(modelMsg.parts[0].text).toBe("I need to navigate to the target page.");
        expect(modelMsg.parts[1].functionCall.name).toBe("navigate");
    });

    it("includes error in function response when step failed", () => {
        const rawResponse = makeGeminiResponse("input", {
            selector: "#field",
            value: "test",
            confidence: 0.8,
            risk: "low",
        });
        const result = extractToolHistoryMessages("gemini-3-pro", rawResponse, {
            success: false,
            error: "Timeout waiting for element",
        });
        const fnMsg = result[1] as any;
        expect(fnMsg.parts[0].functionResponse.response).toMatchObject({
            success: false,
            error: "Timeout waiting for element",
        });
    });

    it("returns empty array when no functionCall part", () => {
        const rawResponse = {
            candidates: [{ content: { parts: [{ text: "Just a text response" }] } }],
        };
        const result = extractToolHistoryMessages("gemini-3-pro", rawResponse, {
            success: true,
        });
        expect(result).toHaveLength(0);
    });

    it("returns empty array when candidates is empty", () => {
        const result = extractToolHistoryMessages("gemini-3-pro", { candidates: [] }, {
            success: true,
        });
        expect(result).toHaveLength(0);
    });
});
