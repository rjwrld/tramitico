import { describe, expect, it, vi } from "vitest";
import { getUserId, type AuthClient } from "./user";

function request(headers: Record<string, string> = {}): Request {
  return new Request("http://localhost/api/ask", { method: "POST", headers });
}

function client(
  result: Awaited<ReturnType<AuthClient["auth"]["getUser"]>>,
): AuthClient & { getUser: ReturnType<typeof vi.fn> } {
  const getUser = vi.fn().mockResolvedValue(result);
  return { auth: { getUser }, getUser };
}

describe("getUserId", () => {
  it("returns the user id for a valid bearer token", async () => {
    const fake = client({ data: { user: { id: "user-1" } }, error: null });
    await expect(
      getUserId(request({ authorization: "Bearer jwt-abc" }), fake),
    ).resolves.toBe("user-1");
    expect(fake.getUser).toHaveBeenCalledWith("jwt-abc");
  });

  it("is anonymous without an Authorization header", async () => {
    const fake = client({ data: { user: null }, error: null });
    await expect(getUserId(request(), fake)).resolves.toBeNull();
    expect(fake.getUser).not.toHaveBeenCalled();
  });

  it("degrades to anonymous on an invalid token instead of failing", async () => {
    const fake = client({
      data: { user: null },
      error: { message: "invalid JWT" },
    });
    await expect(
      getUserId(request({ authorization: "Bearer bad" }), fake),
    ).resolves.toBeNull();
  });
});
