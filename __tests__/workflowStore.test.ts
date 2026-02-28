import { describe, expect, it, vi } from "vitest";

vi.mock("../src/sidebar/utils/supabaseClient", () => ({
  supabase: {
    from: vi.fn(),
  },
}));

import { getCategoryEmoji } from "../src/sidebar/utils/workflowStore";

describe("workflowStore getCategoryEmoji", () => {
  it("returns mapped emoji for known categories", () => {
    expect(getCategoryEmoji("Shopping")).toBe("🛒");
    expect(getCategoryEmoji("Research")).toBe("🔍");
  });

  it("returns fallback emoji for unknown categories", () => {
    expect(getCategoryEmoji("UnknownCategory")).toBe("⚡");
  });
});
