/**
 * Optional caller identity for /api/ask (SPEC §6: auth optional). The route
 * accepts a Supabase access token as `Authorization: Bearer <jwt>`; anything
 * missing or invalid degrades to anonymous rather than failing the ask — the
 * rate-limit tier and history persistence are the only things at stake.
 * Cookie-based sessions arrive with the auth issue and can layer on here.
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
  if (!match) return null;

  const auth = client ?? defaultClient();
  if (!auth) return null;

  const { data, error } = await auth.auth.getUser(match[1]);
  if (error) return null;
  return data.user?.id ?? null;
}
