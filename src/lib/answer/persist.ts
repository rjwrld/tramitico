/**
 * History persistence (SPEC §7, issue #21 req 5): signed-in users get their
 * question/answer/citations saved to `questions` after the stream completes.
 * The table is under RLS keyed to auth.uid(); this writes with the service
 * role after the route has already validated the caller's token, stamping
 * that user_id. Persistence failures are logged, never surfaced — the user
 * already has their answer.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "../database.types";
import type { Citation } from "../retrieval";

type QuestionInsert = Database["public"]["Tables"]["questions"]["Insert"];

/** The slice of the Supabase client this needs — easy to fake in tests. */
export interface QuestionsClient {
  from(table: "questions"): {
    insert(row: QuestionInsert): PromiseLike<{
      error: { message: string } | null;
    }>;
  };
}

export function asQuestionsClient(
  client: SupabaseClient<Database>,
): QuestionsClient {
  return client;
}

function defaultClient(): QuestionsClient | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return asQuestionsClient(
    createClient<Database>(url, key, { auth: { persistSession: false } }),
  );
}

export interface SaveQuestionInput {
  userId: string;
  question: string;
  answer: string;
  citations: Citation[];
}

export async function saveQuestion(
  input: SaveQuestionInput,
  client?: QuestionsClient,
): Promise<void> {
  const questions = client ?? defaultClient();
  if (!questions) {
    console.error("saveQuestion: missing SUPABASE_URL / SERVICE_ROLE_KEY");
    return;
  }
  const { error } = await questions.from("questions").insert({
    user_id: input.userId,
    question: input.question,
    answer: input.answer,
    // Citation is a plain {docKey, docTitle, norma, articulo, url} record;
    // the generated Json type just can't see through the interface.
    citations: input.citations as unknown as Json,
  });
  if (error) {
    console.error(`saveQuestion: insert failed: ${error.message}`);
  }
}
