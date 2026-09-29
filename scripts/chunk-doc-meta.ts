/**
 * The corpus-side half of rebuilding a transcript's prompt: each chunk's
 * document title and norma, which the prompt's `[n]` header prints and a
 * transcript row leaves out. Shared by `prompt-tokens.ts` and
 * `answer-replay.ts`; reads the service-role env the scripts load from
 * `.env.local`.
 */
import { createClient } from "@supabase/supabase-js";
import type { ChunkDocMeta } from "../src/lib/eval/replay";

export async function chunkDocMeta(): Promise<Map<string, ChunkDocMeta>> {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data, error } = await client
    .from("chunks")
    .select("id, documents(title, norma)")
    .limit(5000);
  if (error) throw error;
  const map = new Map<string, ChunkDocMeta>();
  for (const row of data as unknown as {
    id: string;
    documents: { title: string; norma: string | null } | null;
  }[]) {
    map.set(row.id, {
      title: row.documents?.title ?? "",
      norma: row.documents?.norma ?? null,
    });
  }
  return map;
}
