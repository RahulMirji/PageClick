import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSupabase } = vi.hoisted(() => {
  return {
    mockSupabase: {
      auth: {
        getSession: vi.fn(),
        signOut: vi.fn(),
        signInWithIdToken: vi.fn(),
        onAuthStateChange: vi.fn(),
      },
    },
  };
});

vi.mock("../src/sidebar/utils/supabaseClient", () => ({
  supabase: mockSupabase,
}));

import {
  FREE_REQUEST_LIMIT,
  canMakeRequest,
  getRequestCount,
  getUser,
  incrementRequestCount,
} from "../src/sidebar/utils/auth";

const STORAGE_KEY = "__pc_request_count";

describe("auth request counting and session checks", () => {
  const storage: Record<string, any> = {};

  beforeEach(() => {
    Object.keys(storage).forEach((k) => delete storage[k]);
    vi.clearAllMocks();
    (globalThis as any).chrome = {
      storage: {
        local: {
          get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
          set: vi.fn(async (obj: Record<string, unknown>) => {
            Object.assign(storage, obj);
          }),
        },
      },
      identity: {
        getRedirectURL: vi.fn(() => "https://redirect.local"),
        launchWebAuthFlow: vi.fn(),
      },
    };
  });

  it("returns 0 request count when stored date is not today", async () => {
    storage[STORAGE_KEY] = { count: 9, date: "2000-01-01" };

    const count = await getRequestCount();

    expect(count).toBe(0);
  });

  it("increments request count and persists today key", async () => {
    const count = await incrementRequestCount();

    expect(count).toBe(1);
    expect(storage[STORAGE_KEY].count).toBe(1);
    expect(typeof storage[STORAGE_KEY].date).toBe("string");
    expect(storage[STORAGE_KEY].date).toHaveLength(10);
  });

  it("blocks guest when free-tier limit is reached", async () => {
    mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null } });
    storage[STORAGE_KEY] = {
      count: FREE_REQUEST_LIMIT,
      date: new Date().toISOString().slice(0, 10),
    };

    const allowed = await canMakeRequest();

    expect(allowed).toBe(false);
  });

  it("allows signed-in users regardless of request count", async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "u1",
            email: "user@example.com",
            user_metadata: {
              full_name: "Signed In User",
              avatar_url: "https://avatar",
            },
            identities: [],
          },
        },
      },
    });
    storage[STORAGE_KEY] = {
      count: 999,
      date: new Date().toISOString().slice(0, 10),
    };

    const allowed = await canMakeRequest();

    expect(allowed).toBe(true);
  });

  it("maps Supabase session user into app user shape", async () => {
    mockSupabase.auth.getSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: "abc",
            email: "alice@example.com",
            user_metadata: { name: "Alice", picture: "https://img/alice.png" },
            identities: [
              { provider: "google", identity_data: { full_name: "Alice G" } },
            ],
          },
        },
      },
    });

    const user = await getUser();

    expect(user).not.toBeNull();
    expect(user?.id).toBe("abc");
    expect(user?.email).toBe("alice@example.com");
    expect(user?.name).toBe("Alice");
    expect(user?.avatar).toBe("https://img/alice.png");
  });
});
