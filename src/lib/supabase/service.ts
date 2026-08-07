/**
 * The one service-role Supabase client construction (issue #56). Server-side
 * modules build their narrow per-caller interfaces from here instead of each
 * reading env themselves, so a misconfiguration surfaces one way. Callers
 * pick the failure policy: `serviceClient()` throws (retrieval, rate
 * limiting — the ask can't proceed without them), `tryServiceClient()`
 * returns null (persistence, identity — documented to degrade, never fail
 * the ask).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../database.types";

/** Null on missing env — for callers that log and degrade. */
export function tryServiceClient(): SupabaseClient<Database> | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient<Database>(url, key, { auth: { persistSession: false } });
}

/** Throws on missing env — for callers the ask can't proceed without. */
export function serviceClient(): SupabaseClient<Database> {
  const client = tryServiceClient();
  if (!client) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for the service-role Supabase client",
    );
  }
  return client;
}
