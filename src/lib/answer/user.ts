/**
 * Optional caller identity for /api/ask (SPEC §6: auth optional), read from
 * the verified cookie session (#23) — which is how the chat client signs its
 * asks. No session, or one that does not verify, degrades to anonymous rather
 * than failing the ask: the rate-limit tier and history persistence are the
 * only things at stake.
 *
 * The route also used to take a Supabase access token as
 * `Authorization: Bearer <jwt>`. Nothing sent one, and verifying it cost an
 * Auth round trip for any value a caller put there, ahead of the quota, so
 * the header is no longer read: a request carrying only a bearer token is
 * anonymous.
 *
 * The dynamic import keeps `next/headers` out of unit tests; outside a
 * request scope (or on any failure) this degrades to null.
 */
export async function getUserId(): Promise<string | null> {
  try {
    const { createClient } = await import("../supabase/server");
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getClaims();
    if (error) return null;
    const claims = data?.claims as { sub?: string } | undefined;
    return claims?.sub ?? null;
  } catch {
    return null;
  }
}
