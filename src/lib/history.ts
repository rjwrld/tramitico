// Per-user Q&A history, read/delete side (issue #23, SPEC §6/§7).
//
// Every function takes a cookie-scoped Supabase client (src/lib/supabase/server
// or client) so RLS does the row filtering, and the user id always comes from
// the session — callers cannot supply one. Writing history is not this
// module's job: /api/ask persists via src/lib/answer/persist.ts after the
// stream completes.

import type { Database } from "./database.types";

export type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];

// The narrow slice of SupabaseClient<Database> this module needs; unit tests
// substitute a structural fake (same pattern as rate-limit's RpcClient).
export interface HistoryClient {
  auth: {
    getClaims(): Promise<{
      data: { claims: { sub?: string } } | null;
      error: { message: string } | null;
    }>;
  };
  from(table: "questions"): {
    select(columns: "*"): {
      order(
        column: "created_at",
        opts: { ascending: boolean },
      ): PromiseLike<{
        data: QuestionRow[] | null;
        error: { message: string } | null;
      }>;
    };
    delete(): {
      eq(
        column: "id",
        value: string,
      ): PromiseLike<{ error: { message: string } | null }>;
    };
  };
}

// Signed-in user's id from the verified JWT, or null for anonymous visitors.
export async function sessionUserId(
  client: HistoryClient,
): Promise<string | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  return data.claims.sub;
}

// Newest first; RLS limits rows to the session's own.
export async function listQuestions(
  client: HistoryClient,
): Promise<QuestionRow[]> {
  const { data, error } = await client
    .from("questions")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(`history list failed: ${error.message}`);
  return data ?? [];
}

// RLS's "delete own history" policy makes deleting someone else's row a no-op.
export async function deleteQuestion(
  client: HistoryClient,
  id: string,
): Promise<void> {
  const { error } = await client.from("questions").delete().eq("id", id);
  if (error) throw new Error(`history delete failed: ${error.message}`);
}
