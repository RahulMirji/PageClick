import { describe, expect, it } from "vitest";
import {
  estimateTokens,
  trimToContextWindow,
} from "../src/sidebar/utils/tokenUtils";

describe("tokenUtils estimateTokens", () => {
  it("estimates tokens using 4 chars per token and rounds up", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("tokenUtils trimToContextWindow", () => {
  it("keeps newest messages within context window and drops older ones", () => {
    const messages = [
      { role: "user", content: "a".repeat(12000) }, // ~3000 tokens
      { role: "assistant", content: "b".repeat(12000) }, // ~3000 tokens
      { role: "user", content: "c".repeat(12000) }, // ~3000 tokens
    ];

    const result = trimToContextWindow(messages);

    expect(result.trimmed).toHaveLength(2);
    expect(result.trimmed[0].content).toBe(messages[1].content);
    expect(result.trimmed[1].content).toBe(messages[2].content);
    expect(result.dropped).toBe(1);
  });

  it("always keeps the most recent message even if it exceeds the budget", () => {
    const messages = [
      { role: "user", content: "hello" },
      { role: "assistant", content: "x".repeat(30000) }, // ~7500 tokens
    ];

    const result = trimToContextWindow(messages);

    expect(result.trimmed).toHaveLength(1);
    expect(result.trimmed[0].content).toBe(messages[1].content);
    expect(result.dropped).toBe(1);
  });

  it("handles non-string content by tokenizing JSON form", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "hello world" }] as unknown[],
      },
    ];

    const result = trimToContextWindow(messages);

    expect(result.trimmed).toHaveLength(1);
    expect(result.dropped).toBe(0);
  });
});
