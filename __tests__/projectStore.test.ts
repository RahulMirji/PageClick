import { beforeEach, describe, expect, it, vi } from "vitest";

const { supabaseMock, getUserMock } = vi.hoisted(() => ({
  supabaseMock: { from: vi.fn() },
  getUserMock: vi.fn(),
}));

vi.mock("../src/sidebar/utils/supabaseClient", () => ({
  supabase: supabaseMock,
}));

vi.mock("../src/sidebar/utils/auth", () => ({
  getUser: getUserMock,
}));

function makeProjectsQuery(result: { data?: any; error?: any } = {}) {
  const query: any = {
    insert: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(async () => ({ data: result.data, error: result.error })),
    update: vi.fn(() => query),
    delete: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(async () => ({
      data: result.data ?? [],
      error: result.error ?? null,
    })),
  };
  return query;
}

describe("projectStore", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("throws when creating project without signed-in user", async () => {
    getUserMock.mockResolvedValue(null);
    const { createProject } = await import("../src/sidebar/utils/projectStore");

    await expect(createProject("X", ["*x*"], "ins")).rejects.toThrow(
      "Must be signed in",
    );
  });

  it("creates and maps project fields from Supabase row", async () => {
    getUserMock.mockResolvedValue({ id: "u1" });
    const row = {
      id: "p1",
      name: "Work",
      icon: "💼",
      url_patterns: ["*github.com*"],
      instructions: "Focus on PRs",
      is_active: true,
      created_at: "2026-02-28T00:00:00.000Z",
      updated_at: "2026-02-28T01:00:00.000Z",
    };
    supabaseMock.from.mockReturnValue(
      makeProjectsQuery({ data: row, error: null }),
    );

    const { createProject } = await import("../src/sidebar/utils/projectStore");
    const project = await createProject(
      "Work",
      ["*github.com*"],
      "Focus on PRs",
      "💼",
    );

    expect(project.id).toBe("p1");
    expect(project.urlPatterns).toEqual(["*github.com*"]);
    expect(project.instructions).toBe("Focus on PRs");
    expect(project.isActive).toBe(true);
  });

  it("caches listProjects results and reuses cache within TTL", async () => {
    getUserMock.mockResolvedValue({ id: "u1" });
    const rows = [
      {
        id: "p1",
        name: "A",
        icon: "📁",
        url_patterns: ["*a*"],
        instructions: "",
        is_active: true,
        created_at: "2026-02-28T00:00:00.000Z",
        updated_at: "2026-02-28T01:00:00.000Z",
      },
    ];
    const q = makeProjectsQuery({ data: rows, error: null });
    supabaseMock.from.mockReturnValue(q);

    const { listProjects } = await import("../src/sidebar/utils/projectStore");

    const first = await listProjects();
    const second = await listProjects();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(q.order).toHaveBeenCalledTimes(1);
  });

  it("matches active project URL patterns and skips invalid regex patterns", async () => {
    getUserMock.mockResolvedValue({ id: "u1" });
    const rows = [
      {
        id: "bad",
        name: "Bad",
        icon: "📁",
        url_patterns: ["*foo["],
        instructions: "",
        is_active: true,
        created_at: "2026-02-28T00:00:00.000Z",
        updated_at: "2026-02-28T01:00:00.000Z",
      },
      {
        id: "ok",
        name: "Good",
        icon: "📁",
        url_patterns: ["*github.com*"],
        instructions: "",
        is_active: true,
        created_at: "2026-02-28T00:00:00.000Z",
        updated_at: "2026-02-28T01:00:00.000Z",
      },
    ];
    supabaseMock.from.mockReturnValue(
      makeProjectsQuery({ data: rows, error: null }),
    );

    const { matchProject } = await import("../src/sidebar/utils/projectStore");
    const matched = await matchProject("https://github.com/org/repo");

    expect(matched?.id).toBe("ok");
  });

  it("does nothing on update/delete when user is signed out", async () => {
    getUserMock.mockResolvedValue(null);
    const q = makeProjectsQuery({ data: [], error: null });
    supabaseMock.from.mockReturnValue(q);

    const { updateProject, deleteProject } =
      await import("../src/sidebar/utils/projectStore");

    await updateProject("p1", { name: "N" });
    await deleteProject("p1");

    expect(q.update).not.toHaveBeenCalled();
    expect(q.delete).not.toHaveBeenCalled();
  });
});
