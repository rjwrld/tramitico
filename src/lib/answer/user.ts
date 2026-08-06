/**
 * Optional caller identity for /api/ask (SPEC §6: auth optional). The route
 * accepts a Supabase access token as `Authorization: Bearer <jwt>`, falling
 * back to the cookie session (#23) — the browser chat client sends cookies,
 * not a bearer token. Anything missing or invalid degrades to anonymous
 * rather than failing the ask — the rate-limit tier and history persistence
 * are the only things at stake.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

/** The slice of the Supabase client this needs — easy to fake in tests. */
export interface AuthClient {
  auth: {
    getUser(jwt: string): Promise<{
      data: { user: { id: string } | null };
      error: { message: string } | null;
    }>;
  };
}

export function asAuthClient(client: SupabaseClient<Database>): AuthClient {
  return client;
}

function defaultClient(): AuthClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return asAuthClient(
    createClient<Database>(url, key, { auth: { persistSession: false } }),
  );
}

export async function getUserId(
  request: Request,
  client?: AuthClient,
): Promise<string | null> {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return cookieUserId();

  const auth = client ?? defaultClient();
  if (!auth) return null;

  const { data, error } = await auth.auth.getUser(match[1]);
  if (error) return null;
  return data.user?.id ?? null;
}

/** Cookie-session fallback. Dynamic import keeps `next/headers` out of unit
 * tests; outside a request scope (or on any failure) it degrades to null. */
async function cookieUserId(): Promise<string | null> {
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
