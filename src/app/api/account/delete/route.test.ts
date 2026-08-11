import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryClient } from "@/lib/history";

const mockCreateClient = vi.fn<() => Promise<HistoryClient>>();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

const mockDeleteUser = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  serviceClient: () => ({ auth: { admin: { deleteUser: mockDeleteUser } } }),
}));

import { POST } from "./route";

// Same structural fake as src/app/api/history/route.test.ts — `from` is
// unused here (deletion never queries `questions` directly, the CASCADE
// does), but the type requires it.
function fakeClient(userId: string | null): HistoryClient {
  return {
    auth: {
      getClaims: async () =>
        userId
          ? { data: { claims: { sub: userId } }, error: null }
          : { data: null, error: null },
    },
    from: () => ({
      select: () => ({ order: async () => ({ data: [], error: null }) }),
      delete: () => ({ eq: async () => ({ error: null }) }),
    }),
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockDeleteUser.mockReset();
});

describe("POST /api/account/delete", () => {
  it("returns 401 with ES copy when signed out, without touching the admin API", async () => {
    mockCreateClient.mockResolvedValue(fakeClient(null));
    const response = await POST();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatch(/Inicie sesión/);
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it("deletes the session's own user id, never a caller-supplied one", async () => {
    mockCreateClient.mockResolvedValue(fakeClient("user-a"));
    mockDeleteUser.mockResolvedValue({ error: null });

    const response = await POST();

    expect(mockDeleteUser).toHaveBeenCalledWith("user-a");
    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("returns 500 with ES copy when the admin delete fails", async () => {
    mockCreateClient.mockResolvedValue(fakeClient("user-a"));
    mockDeleteUser.mockResolvedValue({ error: { message: "boom" } });

    const response = await POST();

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/No se pudo eliminar la cuenta/);
  });
});
