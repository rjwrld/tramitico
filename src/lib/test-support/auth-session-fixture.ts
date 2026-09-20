/**
 * A fake Supabase Auth session that the real `@supabase/ssr` + `auth-js`
 * stack accepts, so a test can drive an actual cookie write — refresh on the
 * server, `setSession` in the browser — through the library's own option
 * merge and the framework's own `Set-Cookie` serializer, without a network.
 *
 * The access token is an unsigned HS256 JWT: `getClaims()` treats a symmetric
 * `alg` as "cannot verify locally" and falls back to `GET /user`, which
 * `fakeAuthFetch` answers. Nothing here is a secret; the values are shaped
 * like the real thing and nothing else.
 */
import { vi } from "vitest";

export const FAKE_SUPABASE_URL = "https://test-ref.supabase.co";
export const FAKE_PUBLISHABLE_KEY = "sb_publishable_test";
/** `@supabase/ssr` keys the cookie on the project ref (first URL label). */
export const AUTH_COOKIE_NAME = "sb-test-ref-auth-token";

const USER_ID = "00000000-0000-4000-8000-000000000001";

function base64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

/** Unsigned HS256 JWT expiring `expiresInSeconds` from now (negative = expired). */
export function fakeAccessToken(expiresInSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      iss: `${FAKE_SUPABASE_URL}/auth/v1`,
      sub: USER_ID,
      aud: "authenticated",
      role: "authenticated",
      email: "fixture@example.test",
      session_id: "00000000-0000-4000-8000-000000000002",
      iat: now - 60,
      exp: now + expiresInSeconds,
    }),
  );
  return `${header}.${payload}.${base64url("not-a-real-signature")}`;
}

export function fakeUser() {
  return {
    id: USER_ID,
    aud: "authenticated",
    role: "authenticated",
    email: "fixture@example.test",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    created_at: "2026-01-01T00:00:00Z",
  };
}

export function fakeSession(expiresInSeconds: number) {
  const access_token = fakeAccessToken(expiresInSeconds);
  return {
    access_token,
    refresh_token: "fixture-refresh-token",
    token_type: "bearer",
    expires_in: expiresInSeconds,
    expires_at: Math.floor(Date.now() / 1000) + expiresInSeconds,
    user: fakeUser(),
  };
}

/** The cookie value `@supabase/ssr` writes: `base64-` + base64url(JSON). */
export function encodeSessionCookie(session: ReturnType<typeof fakeSession>) {
  return `base64-${base64url(JSON.stringify(session))}`;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Stands in for the hosted Auth server. Answers the token refresh with a
 * session valid for an hour and `GET /user` with the fixture user; anything
 * else is a 404 so an unexpected call fails loudly instead of hanging.
 */
export function fakeAuthFetch() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = init?.method ?? "GET";
    if (
      method === "POST" &&
      url.pathname === "/auth/v1/token" &&
      url.searchParams.get("grant_type") === "refresh_token"
    ) {
      return json(fakeSession(3600));
    }
    if (method === "GET" && url.pathname === "/auth/v1/user") {
      return json(fakeUser());
    }
    return json({ message: `unexpected ${method} ${url.pathname}` }, 404);
  });
}
