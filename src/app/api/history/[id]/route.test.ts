import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoryClient, SessionClient } from "@/lib/history";

const mockCreateClient = vi.fn<() => Promise<SessionClient>>();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

// Records the delete's filters: under the service role they are the whole of
// the ownership check, so the test asserts on them directly (issue #123).
const deleteFilters = vi.fn<(filters: Record<string, string>) => void>();
let deleteError: { message: string } | null = null;
vi.mock("@/lib/supabase/service", () => ({
  serviceClient: () => ({
    from: () => ({
      delete: () => ({
        eq: (column: string, value: string) => ({
          eq: async (column2: string, value2: string) => {
            deleteFilters({ [column]: value, [column2]: value2 });
            return { error: deleteError };
          },
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/history", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/history")>()),
  asHistoryClient: (client: unknown) => client as HistoryClient,
}));

import { DELETE } from "./route";

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

function call(id: string) {
  return DELETE(new Request(`http://localhost/api/history/${id}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  mockCreateClient.mockReset();
  deleteFilters.mockReset();
  deleteError = null;
});

describe("DELETE /api/history/:id", () => {
  it("returns 401 with ES copy when signed out, without deleting anything", async () => {
    mockCreateClient.mockResolvedValue(fakeSession(null));
    const response = await call("q-1");
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatch(/Inicie sesión/);
    expect(deleteFilters).not.toHaveBeenCalled();
  });

  it("deletes by id scoped to the session's own user id", async () => {
    mockCreateClient.mockResolvedValue(fakeSession("user-a"));
    const response = await call("q-9");
    expect(deleteFilters).toHaveBeenCalledWith({
      id: "q-9",
      user_id: "user-a",
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("never takes a user id from the caller", async () => {
    mockCreateClient.mockResolvedValue(fakeSession("user-a"));
    // A path id belonging to user B still deletes under user A's filter, so
    // the query matches no row.
    await call("q-belonging-to-b");
    expect(deleteFilters).toHaveBeenCalledWith({
      id: "q-belonging-to-b",
      user_id: "user-a",
    });
  });

  it("returns 500 with ES copy when the delete fails", async () => {
    mockCreateClient.mockResolvedValue(fakeSession("user-a"));
    deleteError = { message: "boom" };
    const response = await call("q-1");
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toMatch(/No se pudo eliminar la pregunta/);
  });
});
