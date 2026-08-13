import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryClient, SessionClient } from "@/lib/history";

const mockCreateClient = vi.fn<() => Promise<SessionClient>>();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

// The route reads under the service role now (issue #123). The fake stands in
// for it and records the filter, because that filter — not RLS — is what keeps
// one user's history out of another's response.
const selectFilter = vi.fn<(column: string, value: string) => void>();
let rows: unknown[] = [];
vi.mock("@/lib/supabase/service", () => ({
  serviceClient: () => ({
    from: () => ({
      select: () => ({
        eq: (column: string, value: string) => {
          selectFilter(column, value);
          return { order: async () => ({ data: rows, error: null }) };
        },
      }),
    }),
  }),
}));
vi.mock("@/lib/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history")>()),
  // The real adapter casts a SupabaseClient; the fake above is not one.
  asHistoryClient: (client: unknown) => client as HistoryClient,
}));

import { GET } from "./route";

function fakeSession(userId: string | null): SessionClient {
  return {
    auth: {
      getClaims: async () =>
        userId
          ? { data: { claims: { sub: userId } }, error: null }
          : { data: null, error: null },
    },
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  selectFilter.mockReset();
  rows = [];
});

describe("GET /api/history", () => {
  it("returns 401 with ES copy when signed out", async () => {
    mockCreateClient.mockResolvedValue(fakeSession(null));
    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatch(/Inicie sesión/);
  });

  it("returns the session user's questions when signed in", async () => {
    rows = [{ id: "q-1" }, { id: "q-2" }];
    mockCreateClient.mockResolvedValue(fakeSession("user-a"));
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ questions: rows });
  });

  it("scopes the service-role read to the session's own user id", async () => {
    mockCreateClient.mockResolvedValue(fakeSession("user-a"));
    await GET();
    expect(selectFilter).toHaveBeenCalledWith("user_id", "user-a");
  });
});
