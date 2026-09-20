import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_COOKIE_NAME,
  encodeSessionCookie,
  FAKE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  fakeAuthFetch,
  fakeSession,
} from "@/lib/test-support/auth-session-fixture";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));

import { cookies } from "next/headers";
import { createClient } from "./server";

/**
 * `cookies()` from next/headers is a request-scoped store this test cannot
 * open, so it is replaced by a `NextResponse`'s cookie jar — the same
 * `ResponseCookies` class, with the same `getAll` / `set(name, value,
 * options)` surface the factory uses, and it serialises to a real
 * `Set-Cookie` header we can read back.
 */
function seededCookieStore() {
  const response = new NextResponse();
  response.cookies.set(
    AUTH_COOKIE_NAME,
    encodeSessionCookie(fakeSession(-120)),
  );
  vi.mocked(cookies).mockResolvedValue(
    response.cookies as unknown as Awaited<ReturnType<typeof cookies>>,
  );
  return response;
}

function authSetCookie(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${AUTH_COOKIE_NAME}=`));
  expect(header, "the refreshed session cookie is written").toBeDefined();
  return header!;
}

describe("server createClient cookie attributes", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
    vi.stubGlobal("fetch", fakeAuthFetch());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("marks the refreshed session cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const jar = seededCookieStore();

    const supabase = await createClient();
    await supabase.auth.getClaims();

    const header = authSetCookie(jar);
    expect(header).toMatch(/; Secure(;|$)/);
    expect(header).toMatch(/; Path=\//);
  });

  it("leaves Secure off outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const jar = seededCookieStore();

    const supabase = await createClient();
    await supabase.auth.getClaims();

    expect(authSetCookie(jar)).not.toMatch(/; Secure/);
  });
});
