import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryClient } from "@/lib/history";

const mockCreateClient = vi.fn<() => Promise<HistoryClient>>();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

import { GET } from "./route";

function fakeClient(
  userId: string | null,
  rows: unknown[] = [],
): HistoryClient {
  return {
    auth: {
      getClaims: async () =>
        userId
          ? { data: { claims: { sub: userId } }, error: null }
          : { data: null, error: null },
    },
    from: () => ({
      insert: () => ({
        select: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
      select: () => ({
        order: async () => ({
          data: rows as never,
          error: null,
        }),
      }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
});

describe("GET /api/history", () => {
  it("returns 401 with ES copy when signed out", async () => {
    mockCreateClient.mockResolvedValue(fakeClient(null));
    const response = await GET();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatch(/Inicie sesión/);
  });

  it("returns the session user's questions when signed in", async () => {
    const rows = [{ id: "q-1" }, { id: "q-2" }];
    mockCreateClient.mockResolvedValue(fakeClient("user-a", rows));
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ questions: rows });
  });
});
