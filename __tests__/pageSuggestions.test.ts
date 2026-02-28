import { describe, expect, it } from "vitest";
import {
  getPageSuggestions,
  getPageSuggestionsAI,
} from "../src/sidebar/utils/getPageSuggestions";

describe("getPageSuggestions fallback", () => {
  it("returns null for restricted chrome URLs", () => {
    const result = getPageSuggestions("chrome://extensions", "Extensions");
    expect(result).toBeNull();
  });

  it("returns YouTube-specific suggestions for YouTube pages", () => {
    const result = getPageSuggestions(
      "https://www.youtube.com/watch?v=abc",
      "Some Video",
    );

    expect(result).not.toBeNull();
    expect(result?.siteName).toBe("YouTube");
    expect(result?.suggestions).toHaveLength(4);
    expect(result?.suggestions[0].text).toBe("Summarize this video");
  });

  it("returns generic fallback for unknown domains", () => {
    const result = getPageSuggestions(
      "https://docs.acme-example.com/path",
      "Acme Docs",
    );

    expect(result).not.toBeNull();
    expect(result?.siteName).toBe("Docs");
    expect(result?.suggestions).toHaveLength(4);
  });
});

describe("getPageSuggestionsAI", () => {
  it("falls back to hardcoded suggestions when LanguageModel API is unavailable", async () => {
    const result = await getPageSuggestionsAI(
      "https://github.com/org/repo",
      "Repo Title",
    );

    expect(result).not.toBeNull();
    expect(result?.siteName).toBe("GitHub");
    expect(result?.suggestions).toHaveLength(4);
  });

  it("uses cache for repeated calls on the same URL", async () => {
    const first = await getPageSuggestionsAI(
      "https://www.reddit.com/r/typescript",
      "TS Thread",
    );
    const second = await getPageSuggestionsAI(
      "https://www.reddit.com/r/typescript",
      "TS Thread",
    );

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(second).toBe(first);
  });
});
