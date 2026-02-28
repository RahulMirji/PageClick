/**
 * toolSchemas.test.ts
 * Unit tests for the tool schema registry and Gemini adapter.
 */

import { describe, it, expect } from "vitest";
import {
    PAGECLICK_TOOLS,
    CLARIFICATION_TOOLS,
    toGeminiTools,
} from "../src/shared/toolSchemas";

describe("PAGECLICK_TOOLS", () => {
    it("exports an array of tool definitions", () => {
        expect(Array.isArray(PAGECLICK_TOOLS)).toBe(true);
        expect(PAGECLICK_TOOLS.length).toBeGreaterThan(0);
    });

    it("contains all 10 action tools + 1 control tool (task_complete + checkpoint = 13)", () => {
        const names = PAGECLICK_TOOLS.map((t) => t.function.name);
        const expected = [
            "click",
            "input",
            "select",
            "scroll",
            "extract",
            "navigate",
            "eval",
            "download",
            "tabgroup",
            "native",
            "task_complete",
            "checkpoint",
            "ask_user",
        ];
        for (const e of expected) {
            expect(names).toContain(e);
        }
    });

    it("every tool has type=function", () => {
        for (const tool of PAGECLICK_TOOLS) {
            expect(tool.type).toBe("function");
        }
    });

    it("every tool has a non-empty description", () => {
        for (const tool of PAGECLICK_TOOLS) {
            expect(tool.function.description?.length).toBeGreaterThan(5);
        }
    });

    it("every tool has a parameters object with type=object", () => {
        for (const tool of PAGECLICK_TOOLS) {
            expect(tool.function.parameters?.type).toBe("object");
        }
    });

    it("every tool has strict: true for structured outputs", () => {
        for (const tool of [...PAGECLICK_TOOLS, ...CLARIFICATION_TOOLS]) {
            expect(tool.function.strict).toBe(true);
        }
    });

    it("every tool parameters has additionalProperties: false", () => {
        for (const tool of [...PAGECLICK_TOOLS, ...CLARIFICATION_TOOLS]) {
            expect(tool.function.parameters?.additionalProperties).toBe(false);
        }
    });

    it("action tools have a selector parameter", () => {
        const actionTools = ["click", "input", "select", "scroll", "extract"];
        for (const name of actionTools) {
            const tool = PAGECLICK_TOOLS.find((t) => t.function.name === name);
            expect(tool?.function.parameters?.properties?.selector).toBeDefined();
        }
    });

    it("task_complete has summary and nextSteps parameters", () => {
        const tool = PAGECLICK_TOOLS.find((t) => t.function.name === "task_complete");
        expect(tool?.function.parameters?.properties?.summary).toBeDefined();
        expect(tool?.function.parameters?.properties?.nextSteps).toBeDefined();
    });

    it("checkpoint has reason, message, and canSkip parameters", () => {
        const tool = PAGECLICK_TOOLS.find((t) => t.function.name === "checkpoint");
        expect(tool?.function.parameters?.properties?.reason).toBeDefined();
        expect(tool?.function.parameters?.properties?.message).toBeDefined();
        expect(tool?.function.parameters?.properties?.canSkip).toBeDefined();
    });
});

describe("CLARIFICATION_TOOLS", () => {
    it("contains task_ready and ask_user", () => {
        const names = CLARIFICATION_TOOLS.map((t) => t.function.name);
        expect(names).toContain("task_ready");
        expect(names).toContain("ask_user");
    });

    it("does not contain action tools (e.g. click)", () => {
        const names = CLARIFICATION_TOOLS.map((t) => t.function.name);
        expect(names).not.toContain("click");
        expect(names).not.toContain("navigate");
    });
});

describe("toGeminiTools", () => {
    it("returns an object with functionDeclarations", () => {
        const gemini = toGeminiTools(PAGECLICK_TOOLS);
        expect(gemini).toHaveProperty("functionDeclarations");
        expect(Array.isArray(gemini.functionDeclarations)).toBe(true);
    });

    it("preserves all tool names", () => {
        const gemini = toGeminiTools(PAGECLICK_TOOLS);
        const openaiNames = PAGECLICK_TOOLS.map((t) => t.function.name);
        const geminiNames = gemini.functionDeclarations.map((d: any) => d.name);
        for (const name of openaiNames) {
            expect(geminiNames).toContain(name);
        }
    });

    it("preserves descriptions", () => {
        const gemini = toGeminiTools(PAGECLICK_TOOLS);
        for (const decl of gemini.functionDeclarations) {
            expect(decl.description?.length).toBeGreaterThan(5);
        }
    });

    it("maps parameters to Gemini schema format", () => {
        const gemini = toGeminiTools(PAGECLICK_TOOLS);
        for (const decl of gemini.functionDeclarations) {
            // Gemini uses `parameters` with `properties`
            expect(decl.parameters).toBeDefined();
            expect(decl.parameters.type).toBe("OBJECT");
        }
    });

    it("strips strict and additionalProperties from Gemini declarations", () => {
        const gemini = toGeminiTools(PAGECLICK_TOOLS);
        for (const decl of gemini.functionDeclarations) {
            expect(decl.parameters).not.toHaveProperty("strict");
            expect(decl.parameters).not.toHaveProperty("additionalProperties");
            // Also check nested properties don't have these keys
            if (decl.parameters.properties) {
                for (const prop of Object.values(decl.parameters.properties) as any[]) {
                    expect(prop).not.toHaveProperty("strict");
                    expect(prop).not.toHaveProperty("additionalProperties");
                }
            }
        }
    });

    it("preserves enum arrays in Gemini conversion", () => {
        // The click tool has risk with enum ["low", "medium", "high", "critical"]
        const gemini = toGeminiTools(PAGECLICK_TOOLS);
        const click = gemini.functionDeclarations.find((d: any) => d.name === "click");
        expect(click).toBeDefined();
        const riskProp = click?.parameters?.properties?.risk;
        expect(riskProp).toBeDefined();
        expect(riskProp.enum).toEqual(["low", "medium", "high"]);
    });

    it("works with an empty array", () => {
        const gemini = toGeminiTools([]);
        expect(gemini.functionDeclarations).toEqual([]);
    });
});
