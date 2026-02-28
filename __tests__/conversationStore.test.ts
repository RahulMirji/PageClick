import { describe, expect, it, vi } from "vitest";

vi.mock("../src/sidebar/utils/supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

vi.mock("../src/sidebar/utils/auth", () => ({
  getUser: vi.fn(async () => null),
}));

import { encodeMessageContent } from "../src/sidebar/utils/conversationStore";

describe("conversationStore encodeMessageContent", () => {
  it("returns plain content when no metadata exists", () => {
    const encoded = encodeMessageContent({
      role: "assistant",
      content: "Simple response",
    });

    expect(encoded).toBe("Simple response");
  });

  it("encodes tokenCount, planConfirm, and taskProgress metadata", () => {
    const encoded = encodeMessageContent({
      role: "assistant",
      content: "Done",
      tokenCount: 123,
      planConfirm: {
        summary: "Proceed?",
        status: "approved",
        onProceed: () => {},
        onReject: () => {},
      },
      taskProgress: {
        explanation: "Running steps",
        steps: [
          { description: "Step 1", status: "completed" },
          { description: "Step 2", status: "running" },
        ],
      },
    });

    expect(encoded.startsWith("__PC_META__:")).toBe(true);

    const parsed = JSON.parse(encoded.slice("__PC_META__:".length));
    expect(parsed.text).toBe("Done");
    expect(parsed.tokenCount).toBe(123);
    expect(parsed.planConfirm.summary).toBe("Proceed?");
    expect(parsed.taskProgress.steps).toHaveLength(2);
  });
});
