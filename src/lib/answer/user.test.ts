import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_COOKIE_NAME,
  encodeSessionCookie,
  FAKE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  fakeAccessToken,
  fakeAuthFetch,
  fakeSession,
  fakeUser,
} from "@/lib/test-support/auth-session-fixture";

vi.mock("next/headers", () => ({ cookies: vi.fn(), headers: vi.fn() }));

import { cookies, headers } from "next/headers";
import { getUserId } from "./user";

/**
 * The request scope `getUserId` runs in: a cookie jar (a `NextResponse`'s,
 * the same `ResponseCookies` surface next/headers hands the server client)
 * and the request's headers, which is the only way a bearer token could
 * reach it.
 */
function requestScope(
  options: { session?: boolean; authorization?: string } = {},
): void {
  const jar = new NextResponse().cookies;
  if (options.session) {
    jar.set(AUTH_COOKIE_NAME, encodeSessionCookie(fakeSession(3600)));
  }
  vi.mocked(cookies).mockResolvedValue(
    jar as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  const incoming = new Headers();
  if (options.authorization) {
    incoming.set("authorization", options.authorization);
  }
  vi.mocked(headers).mockResolvedValue(
    incoming as unknown as Awaited<ReturnType<typeof headers>>,
  );
}

describe("getUserId", () => {
  let fetchSpy: ReturnType<typeof fakeAuthFetch>;

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
    // Answers `GET /user` for the fixture's token, so a token that reached
    // Auth by any route would come back as a signed-in user.
    fetchSpy = fakeAuthFetch();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("reads the signed-in user from the verified cookie session", async () => {
    requestScope({ session: true });

    await expect(getUserId()).resolves.toBe(fakeUser().id);
  });

  it("is anonymous with no session, without asking Auth", async () => {
    requestScope();

    await expect(getUserId()).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ignores a bearer token: anonymous, with no call to Auth", async () => {
    // A token Auth would accept, so only the header being unread keeps the
    // caller anonymous — and a malformed one is no different.
    for (const authorization of [
      `Bearer ${fakeAccessToken(3600)}`,
      "Bearer not-a-jwt",
      `Bearer ${"a".repeat(4096)}`,
    ]) {
      requestScope({ authorization });

      await expect(getUserId()).resolves.toBeNull();
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("takes identity from the cookie, never from a bearer token beside it", async () => {
    requestScope({ session: true, authorization: "Bearer not-a-jwt" });

    await expect(getUserId()).resolves.toBe(fakeUser().id);
    expect(fetchSpy).toHaveBeenCalled();
    for (const [input] of fetchSpy.mock.calls) {
      expect(String(input)).toBe(`${FAKE_SUPABASE_URL}/auth/v1/user`);
    }
  });

  it("degrades to anonymous when the session does not verify", async () => {
    requestScope({ session: true });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ message: "invalid JWT" }, { status: 401 }),
      ),
    );

    await expect(getUserId()).resolves.toBeNull();
  });

  it("degrades to anonymous outside a request scope", async () => {
    vi.mocked(cookies).mockRejectedValue(new Error("outside a request scope"));

    await expect(getUserId()).resolves.toBeNull();
  });
});
