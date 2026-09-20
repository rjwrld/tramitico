import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  AUTH_COOKIE_NAME,
  encodeSessionCookie,
  FAKE_PUBLISHABLE_KEY,
  FAKE_SUPABASE_URL,
  fakeAuthFetch,
  fakeSession,
} from "@/lib/test-support/auth-session-fixture";
import { updateSession } from "./proxy";

/**
 * Drives the real `@supabase/ssr` client through a session refresh: the
 * request carries an expired session cookie, the fake Auth server answers the
 * refresh, and the library writes the new cookie onto the response through
 * `setAll`. The assertion is on the `Set-Cookie` header Next.js actually
 * serialises, not on the options object we pass — that is the string a
 * browser sees.
 */
function requestWithExpiredSession(): NextRequest {
  const value = encodeSessionCookie(fakeSession(-120));
  return new NextRequest("https://tramitico.com/historial", {
    headers: { cookie: `${AUTH_COOKIE_NAME}=${value}` },
  });
}

function authSetCookie(response: Response): string {
  const header = response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${AUTH_COOKIE_NAME}=`));
  expect(header, "the refreshed session cookie is written").toBeDefined();
  return header!;
}

describe("updateSession cookie attributes", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", FAKE_SUPABASE_URL);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", FAKE_PUBLISHABLE_KEY);
    vi.stubGlobal("fetch", fakeAuthFetch());
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("marks the refreshed session cookie Secure in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const response = await updateSession(requestWithExpiredSession());
    const header = authSetCookie(response);

    expect(header).toMatch(/; Secure(;|$)/);
    // The library defaults still apply alongside ours.
    expect(header).toMatch(/; Path=\//);
    expect(header).toMatch(/; SameSite=lax/i);
  });

  it("leaves Secure off outside production so http://localhost keeps the session", async () => {
    vi.stubEnv("NODE_ENV", "development");

    const response = await updateSession(requestWithExpiredSession());
    const header = authSetCookie(response);

    expect(header).not.toMatch(/; Secure/);
  });
});
