// Free: the replay input for #579's paid step. Wave E's row for
// `rb-seguimiento-le-cobro-iva` (the false absence) with the chunk the pin
// appends, read verbatim from the local stack, as marker 12 and tagged
// `salarioBase`; three copies, so one `answer-replay` reads it ×3.
//
//   pnpm exec tsx eval/runs/2026-10-09-579/replay-input.ts > eval/runs/2026-10-09-579/replay-input.jsonl
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const CASE = "rb-seguimiento-le-cobro-iva";
const WAVE_E = path.resolve(
  __dirname,
  "../2026-10-09-497-wave-e/lane/groundedness-claude-sonnet-5-5-effort-low-20261009T031939Z.jsonl",
);

const env = path.resolve(__dirname, "../../../.env.local");
if (existsSync(env)) {
  for (const line of readFileSync(env, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main(): Promise<void> {
  const url = process.env.SUPABASE_URL ?? "";
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)/.test(url)) {
    throw new Error("SUPABASE_URL is not the local stack; refusing");
  }
  const row = readFileSync(WAVE_E, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line))
    .find((r) => r.id === CASE);
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data, error } = await client
    .from("chunks")
    .select("id, articulo, content, documents!inner(doc_key)")
    .eq("documents.doc_key", "salario-base-2026")
    .eq("part", 0);
  if (error) throw error;
  if (data.length !== 1)
    throw new Error(`expected one chunk, got ${data.length}`);
  const [base] = data as unknown as {
    id: string;
    articulo: string;
    content: string;
  }[];
  const chunks = [
    ...row.chunks,
    {
      marker: row.chunks.length + 1,
      chunkId: base.id,
      docKey: "salario-base-2026",
      articulo: base.articulo,
      content: base.content,
      pin: "salarioBase",
    },
  ];
  for (let i = 0; i < 3; i++) console.log(JSON.stringify({ ...row, chunks }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
