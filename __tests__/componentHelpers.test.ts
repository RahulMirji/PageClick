import { describe, expect, it, vi } from "vitest";

vi.mock("../src/sidebar/utils/conversationStore", () => ({
  listConversations: vi.fn(),
  deleteConversation: vi.fn(),
  loadMessages: vi.fn(),
}));

vi.mock("../src/sidebar/utils/projectStore", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
}));

import { cleanDisplayContent } from "../src/sidebar/components/ChatView";
import { groupByDate, formatTime } from "../src/sidebar/components/HistoryView";
import { parseUrlPatterns } from "../src/sidebar/components/ProjectsView";

describe("ChatView helper cleanDisplayContent", () => {
  it("removes structured task blocks and keeps human-readable content", () => {
    const input = [
      "Working on it.",
      '<<<ACTION_PLAN>>> {"actions":[]} <<<END_ACTION_PLAN>>>',
      "Done!",
      '<<<TASK_COMPLETE>>> {"summary":"ok","nextSteps":[]} <<<END_TASK_COMPLETE>>>',
    ].join("\n");

    const output = cleanDisplayContent(input);

    expect(output).toContain("Working on it.");
    expect(output).toContain("Done!");
    expect(output).not.toContain("<<<ACTION_PLAN>>>");
    expect(output).not.toContain("<<<TASK_COMPLETE>>>");
  });
});

describe("HistoryView helpers", () => {
  it("groups conversations by recency buckets", () => {
    const now = Date.now();
    const oneHour = 60 * 60 * 1000;
    const oneDay = 24 * oneHour;

    const groups = groupByDate([
      { id: "t", title: "Today", createdAt: now, updatedAt: now },
      {
        id: "y",
        title: "Yesterday",
        createdAt: now - oneDay,
        updatedAt: now - oneDay,
      },
      {
        id: "w",
        title: "This week",
        createdAt: now - 3 * oneDay,
        updatedAt: now - 3 * oneDay,
      },
      {
        id: "o",
        title: "Older",
        createdAt: now - 12 * oneDay,
        updatedAt: now - 12 * oneDay,
      },
    ]);

    const labels = groups.map((g) => g.label);
    expect(labels).toContain("Today");
    expect(labels).toContain("Yesterday");
    expect(labels).toContain("This Week");
    expect(labels).toContain("Older");
  });

  it("formats recent timestamps with today/yesterday labels", () => {
    const now = Date.now();
    const yesterday = now - 24 * 60 * 60 * 1000;

    expect(formatTime(now).startsWith("Today · ")).toBe(true);
    expect(formatTime(yesterday).startsWith("Yesterday · ")).toBe(true);
  });
});

describe("ProjectsView helper parseUrlPatterns", () => {
  it("splits and trims URL patterns from multi-line input", () => {
    const patterns = parseUrlPatterns(
      "  *github.com*  \n\n*jira.*\n   *docs.example.com*   ",
    );

    expect(patterns).toEqual(["*github.com*", "*jira.*", "*docs.example.com*"]);
  });
});
