// Per-user Q&A history, read/delete side (issue #23, SPEC §6/§7).
//
// Since the least-privilege lockdown (issue #123) `anon`/`authenticated` hold
// no privileges on `public`, so the queries here run under `service_role` from
// an API route — which bypasses RLS. The `userId` argument is therefore the
// only thing scoping rows to their owner, and it must come from
// `sessionUserId()` on the route's cookie-scoped client, never from the
// request. Writing history is not this module's job: /api/ask persists via
// src/lib/answer/persist.ts after the stream completes.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

export type QuestionRow = Database["public"]["Tables"]["questions"]["Row"];

/**
 * A rejected history query. The message used to be `history list failed:
 * ${error.message}` — a PostgREST message can quote the offending row, and on
 * `questions` the row is somebody's question (#136). Both routes already
 * swallow this into canned Spanish, so nothing user-facing changes; what
 * changes is that if it ever *is* logged, the class name is the whole story
 * and `describeError` reads the driver's SQLSTATE off `cause`.
 */
export class HistoryQueryError extends Error {
  constructor(
    readonly op: "list" | "delete",
    cause: unknown,
  ) {
    super(`history ${op} failed`, { cause });
    this.name = "HistoryQueryError";
  }
}

// The auth half: a cookie-scoped client, the only place a user id may come
// from. Kept separate from HistoryClient because the two are now different
// clients — the session is the caller's, the query is the service role's.
export interface SessionClient {
  auth: {
    getClaims(): Promise<{
      data: { claims: { sub?: string } } | null;
      error: { message: string } | null;
    }>;
  };
}

// The narrow slice of SupabaseClient<Database> the queries need; unit tests
// substitute a structural fake (same pattern as rate-limit's RpcClient).
export interface HistoryClient {
  from(table: "questions"): {
    select(columns: "*"): {
      eq(
        column: "user_id",
        value: string,
      ): {
        order(
          column: "created_at",
          opts: { ascending: boolean },
        ): PromiseLike<{
          data: QuestionRow[] | null;
          error: { message: string } | null;
        }>;
      };
    };
    delete(): {
      eq(
        column: "id",
        value: string,
      ): {
        eq(
          column: "user_id",
          value: string,
        ): PromiseLike<{ error: { message: string } | null }>;
      };
    };
  };
}

// Narrows a real client to the slice above — the same adapter shape
// persist.ts uses, and the seam the unit tests replace with a fake. The cast
// goes through `unknown` because checking a real client against the filter
// chain above ("select → eq → order") makes tsc give up with "type
// instantiation is excessively deep"; the runtime shapes do match.
export function asHistoryClient(
  client: SupabaseClient<Database>,
): HistoryClient {
  return client as unknown as HistoryClient;
}

// Signed-in user's id from the verified JWT, or null for anonymous visitors.
export async function sessionUserId(
  client: SessionClient,
): Promise<string | null> {
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims.sub) return null;
  return data.claims.sub;
}

// Newest first, scoped to one owner. The service role bypasses RLS, so this
// `user_id` filter is the isolation — not a redundant convenience.
export async function listQuestions(
  client: HistoryClient,
  userId: string,
): Promise<QuestionRow[]> {
  const { data, error } = await client
    .from("questions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new HistoryQueryError("list", error);
  return data ?? [];
}

// Deleting someone else's row is a no-op: the `user_id` filter, not RLS, is
// what makes it one under the service role.
export async function deleteQuestion(
  client: HistoryClient,
  id: string,
  userId: string,
): Promise<void> {
  const { error } = await client
    .from("questions")
    .delete()
    .eq("id", id)
    .eq("user_id", userId);
  if (error) throw new HistoryQueryError("delete", error);
}
