import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Attributes every `sb-*` auth cookie is written with, on top of
 * `@supabase/ssr`'s defaults (`path=/`, `SameSite=Lax`, 400-day max-age, not
 * HttpOnly — the browser client reads it). The library never derives `Secure`
 * from the request protocol, so without this the session cookie would also
 * ride a plaintext request. Production only: `next dev` serves over http and
 * browsers drop a `Secure` cookie set from an http origin. Every deployed
 * build — production or preview — runs with `NODE_ENV=production` over TLS.
 *
 * Shared by the browser, server-component and proxy clients so the three write
 * paths cannot drift.
 */
export function authCookieOptions(): CookieOptionsWithName {
  return { secure: process.env.NODE_ENV === "production" };
}
