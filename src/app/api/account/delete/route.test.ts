import { beforeEach, describe, expect, it, vi } from "vitest";

// The narrow slice of the cookie-scoped client the route uses. Route files
// cannot export extra symbols (Next type-checks them), so the shape is
// restated here — a structural fake, same idea as HistoryClient.
interface AccountClient {
  auth: {
    getUser(): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
    getSession(): Promise<{
      data: { session: { access_token: string } | null };
      error: { message: string } | null;
    }>;
  };
}

const mockCreateClient = vi.fn<() => Promise<AccountClient>>();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

const mockDeleteUser = vi.fn();
const mockSignOut = vi.fn();
vi.mock("@/lib/supabase/service", () => ({
  serviceClient: () => ({
    auth: { admin: { deleteUser: mockDeleteUser, signOut: mockSignOut } },
  }),
}));

import { POST } from "./route";

function fakeClient(
  userId: string | null,
  accessToken: string | null = "token-a",
): AccountClient {
  return {
    auth: {
      getUser: async () =>
        userId
          ? { data: { user: { id: userId } }, error: null }
          : {
              data: { user: null },
              error: { message: "Auth session missing" },
            },
      getSession: async () => ({
        data: { session: accessToken ? { access_token: accessToken } : null },
        error: null,
      }),
    },
  };
}

beforeEach(() => {
  mockCreateClient.mockReset();
  mockDeleteUser.mockReset();
  mockSignOut.mockReset();
  mockSignOut.mockResolvedValue({ error: null });
  mockDeleteUser.mockResolvedValue({ error: null });
});

describe("POST /api/account/delete", () => {
  it("returns 401 with ES copy when signed out, without touching the admin API", async () => {
    mockCreateClient.mockResolvedValue(fakeClient(null));
    const response = await POST();
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toMatch(/Inicie sesión/);
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(mockSignOut).not.toHaveBeenCalled();
  });

  it("globally signs the caller out before deleting, so no refresh token outlives the account", async () => {
    const order: string[] = [];
    mockSignOut.mockImplementation(async () => {
      order.push("signOut");
      return { error: null };
    });
    mockDeleteUser.mockImplementation(async () => {
      order.push("deleteUser");
      return { error: null };
    });
    mockCreateClient.mockResolvedValue(fakeClient("user-a"));

    const response = await POST();

    // Order matters: GoTrue rejects a sign-out whose JWT names a user that no
    // longer exists ("User from sub claim in JWT does not exist").
    expect(order).toEqual(["signOut", "deleteUser"]);
    expect(mockSignOut).toHaveBeenCalledWith("token-a", "global");
    expect(response.status).toBe(200);
  });

  it("deletes the session's own user id, never a caller-supplied one", async () => {
    mockCreateClient.mockResolvedValue(fakeClient("user-a"));

    const response = await POST();

    expect(mockDeleteUser).toHaveBeenCalledWith("user-a");
    expect(mockDeleteUser).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("still deletes when the global sign-out fails — deletion is the user's intent", async () => {
    mockCreateClient.mockResolvedValue(fakeClient("user-a"));
    mockSignOut.mockResolvedValue({ error: { message: "sign-out boom" } });

    const response = await POST();

    expect(mockDeleteUser).toHaveBeenCalledWith("user-a");
    expect(response.status).toBe(200);
  });

  it("deletes without attempting a sign-out when no access token is readable", async () => {
    mockCreateClient.mockResolvedValue(fakeClient("user-a", null));

    const response = await POST();

    expect(mockSignOut).not.toHaveBeenCalled();
    expect(mockDeleteUser).toHaveBeenCalledWith("user-a");
    expect(response.status).toBe(200);
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
