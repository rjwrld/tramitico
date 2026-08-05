// Per-user Q&A history (issue #23, SPEC §6/§7).
//
// Every function takes a cookie-scoped Supabase client (src/lib/supabase/server
// or client) so RLS does the row filtering, and the user id always comes from
// the session — callers cannot supply one. /api/ask's persistence path (#21)
// calls saveQuestion after streaming completes.

import type { Database, Json } from "./database.types";

export type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];
type QuestionInsert = Database["public"]["Tables"]["questions"]["Insert"];

export interface QuestionEntry {
  question: string;
  answer: string;
  citations: Json;
}

export type SaveResult =
  { saved: true; id: string } | { saved: false; reason: "anonymous" | "error" };

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
    insert(values: QuestionInsert): {
      select(columns: "id"): {
        single(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
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

export async function saveQuestion(
  client: HistoryClient,
  entry: QuestionEntry,
): Promise<SaveResult> {
  const userId = await sessionUserId(client);
  if (!userId) return { saved: false, reason: "anonymous" };

  const { data, error } = await client
    .from("questions")
    .insert({ ...entry, user_id: userId })
    .select("id")
    .single();
  if (error || !data) return { saved: false, reason: "error" };
  return { saved: true, id: data.id };
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
