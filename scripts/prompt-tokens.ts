/**
 * Prompt tokens per ask, from a groundedness transcript (#305). Rebuilds the
 * exact answer prompt each row's chunks produced (`buildUserPrompt` +
 * `ANSWER_SYSTEM_PROMPT`, derived figures re-resolved from the same chunks)
 * and asks Anthropic's free count_tokens endpoint for the input size.
 *
 *   pnpm prompt-tokens <transcript.jsonl> [<transcript.jsonl> …]
 *
 * `docTitle` and `norma` are not in a transcript row, so they are read back
 * from the corpus database by chunk id; the prompt is otherwise rebuilt
 * verbatim. Reads `.env.local` like `ingest.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveDerivedFigures } from "../src/lib/answer/derived";
import { DEFAULT_ANSWER_MODEL } from "../src/lib/answer/model";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../src/lib/answer/prompt";
import type { RetrievedChunk } from "../src/lib/retrieval";

/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

interface Row {
  id: string;
  tier: unknown;
  query: string;
  answer: string;
  chunks: {
    marker: number;
    chunkId: string;
    docKey: string;
    articulo: string | null;
    content: string;
  }[];
}

async function docMeta(): Promise<
  Map<string, { title: string; norma: string | null }>
> {
  const client = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data, error } = await client
    .from("chunks")
    .select("id, documents(title, norma)")
    .limit(5000);
  if (error) throw error;
  const map = new Map<string, { title: string; norma: string | null }>();
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

async function countTokens(system: string, prompt: string): Promise<number> {
  const res = await fetch(
    "https://api.anthropic.com/v1/messages/count_tokens",
    {
      method: "POST",
      headers: {
        "x-api-key": process.env.ANTHROPIC_API_KEY!,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.ANSWER_MODEL || DEFAULT_ANSWER_MODEL,
        system,
        messages: [{ role: "user", content: prompt }],
      }),
    },
  );
  if (!res.ok)
    throw new Error(`count_tokens ${res.status}: ${await res.text()}`);
  return ((await res.json()) as { input_tokens: number }).input_tokens;
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const meta = await docMeta();
  for (const file of process.argv.slice(2)) {
    const rows = readFileSync(file, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Row);
    const counts: { id: string; chunks: number; tokens: number }[] = [];
    for (const row of rows) {
      if (row.chunks.length === 0) continue; // weak-retrieval decline: no prompt
      const chunks = row.chunks.map((c) => {
        const m = meta.get(c.chunkId);
        return {
          chunkId: c.chunkId,
          docKey: c.docKey,
          docTitle: m?.title ?? c.docKey,
          norma: m?.norma ?? null,
          articulo: c.articulo,
          content: c.content,
        } as RetrievedChunk;
      });
      const derivedFigures = resolveDerivedFigures(chunks);
      const prompt = buildUserPrompt(row.query, chunks, { derivedFigures });
      const tokens = await countTokens(ANSWER_SYSTEM_PROMPT, prompt);
      counts.push({ id: row.id, chunks: chunks.length, tokens });
    }
    const total = counts.reduce((n, c) => n + c.tokens, 0);
    const sorted = counts.map((c) => c.tokens).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    console.log(
      `\n${path.basename(file)}: ${counts.length} prompts, mean ${Math.round(total / counts.length)} tokens, median ${median}, min ${sorted[0]}, max ${sorted[sorted.length - 1]}, total ${total}`,
    );
    for (const c of counts) console.log(`  ${c.id}\t${c.chunks}\t${c.tokens}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
