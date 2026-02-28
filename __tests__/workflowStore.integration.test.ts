import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
}));

vi.mock("../src/sidebar/utils/supabaseClient", () => ({
  supabase: supabaseMock,
}));

function makeWorkflowQuery(result: { data?: any[]; error?: any }) {
  const query: any = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({
      data: result.data ?? [],
      error: result.error ?? null,
    })),
  };
  return query;
}

describe("workflowStore listWorkflows", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("groups workflows by category and caches within TTL", async () => {
    const rows = [
      {
        id: "1",
        category: "Research",
        title: "A",
        description: "",
        prompt: "",
        icon: "i",
        sort_order: 1,
      },
      {
        id: "2",
        category: "Research",
        title: "B",
        description: "",
        prompt: "",
        icon: "i",
        sort_order: 2,
      },
      {
        id: "3",
        category: "Shopping",
        title: "C",
        description: "",
        prompt: "",
        icon: "i",
        sort_order: 3,
      },
    ];
    const q = makeWorkflowQuery({ data: rows });
    supabaseMock.from.mockReturnValue(q);

    const { listWorkflows } =
      await import("../src/sidebar/utils/workflowStore");

    const first = await listWorkflows();
    const second = await listWorkflows();

    expect(first).toHaveLength(2);
    expect(first[0].category).toBe("Research");
    expect(first[0].workflows).toHaveLength(2);
    expect(q.order).toHaveBeenCalledTimes(1);
    expect(second[0].workflows).toHaveLength(2);
  });

  it("returns cached groups when backend returns error", async () => {
    const okRows = [
      {
        id: "1",
        category: "Media",
        title: "X",
        description: "",
        prompt: "",
        icon: "i",
        sort_order: 1,
      },
    ];
    const okQuery = makeWorkflowQuery({ data: okRows });
    supabaseMock.from.mockReturnValue(okQuery);

    const { listWorkflows } =
      await import("../src/sidebar/utils/workflowStore");
    const baseline = await listWorkflows();
    expect(baseline).toHaveLength(1);

    const errQuery = makeWorkflowQuery({
      data: [],
      error: { message: "db down" },
    });
    supabaseMock.from.mockReturnValue(errQuery);

    const fallback = await listWorkflows();
    expect(fallback).toHaveLength(1);
    expect(fallback[0].category).toBe("Media");
  });
});
