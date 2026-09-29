/**
 * Prompt tokens per ask, from a groundedness transcript (#305). Rebuilds the
 * exact answer prompt each row's chunks produced (`buildUserPrompt` +
 * `ANSWER_SYSTEM_PROMPT`, derived figures re-resolved from the same chunks)
 * and asks Anthropic's free count_tokens endpoint for the input size.
 *
 *   pnpm prompt-tokens <transcript.jsonl> [<transcript.jsonl> …]
 *
 * `docTitle` and `norma` are not in a transcript row, so they are read back
 * from the corpus database by chunk id (`replayChunks`, #451); the prompt is
 * otherwise rebuilt verbatim. Reads `.env.local` like `ingest.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { resolveDerivedFigures } from "../src/lib/answer/derived";
import { DEFAULT_ANSWER_MODEL } from "../src/lib/answer/model";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../src/lib/answer/prompt";
import { parseTranscript, replayChunks } from "../src/lib/eval/replay";
import { chunkDocMeta } from "./chunk-doc-meta";

/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
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
  const meta = await chunkDocMeta();
  for (const file of process.argv.slice(2)) {
    const rows = parseTranscript(readFileSync(file, "utf8"));
    const counts: { id: string; chunks: number; tokens: number }[] = [];
    for (const row of rows) {
      if (row.chunks.length === 0) continue; // weak-retrieval decline: no prompt
      const chunks = replayChunks(row, meta);
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
