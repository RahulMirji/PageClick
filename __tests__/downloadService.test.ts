import { describe, expect, it } from "vitest";
import { formatConversationAsMarkdown } from "../src/sidebar/utils/downloadService";

describe("downloadService formatConversationAsMarkdown", () => {
  it("formats conversation with headings and participant labels", () => {
    const markdown = formatConversationAsMarkdown(
      "Test Chat",
      [
        { role: "user", content: "Hello there" },
        { role: "assistant", content: "General Kenobi" },
      ],
      new Date("2026-02-28T00:00:00.000Z"),
    );

    expect(markdown).toContain("# Test Chat");
    expect(markdown).toContain("_Exported from PageClick");
    expect(markdown).toContain("### 👤 You");
    expect(markdown).toContain("### 🤖 PageClick");
    expect(markdown).toContain("Hello there");
    expect(markdown).toContain("General Kenobi");
  });

  it("strips structured agent blocks from assistant content", () => {
    const markdown = formatConversationAsMarkdown("Structured", [
      {
        role: "assistant",
        content:
          'Working on it...\n<<<ACTION_PLAN>>> {"actions":[]} <<<END_ACTION_PLAN>>>\nDone.',
      },
    ]);

    expect(markdown).toContain("Working on it...");
    expect(markdown).toContain("Done.");
    expect(markdown).not.toContain("<<<ACTION_PLAN>>>");
    expect(markdown).not.toContain("<<<END_ACTION_PLAN>>>");
  });

  it("skips empty messages", () => {
    const markdown = formatConversationAsMarkdown("Empty Filter", [
      { role: "user", content: "   " },
      { role: "assistant", content: "Kept message" },
    ]);

    expect(markdown).not.toContain("### 👤 You");
    expect(markdown).toContain("Kept message");
  });
});
