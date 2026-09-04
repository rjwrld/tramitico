/**
 * ADR 0003 companion: for the canary question, report (a) the rank of each
 * acceptable target in each provider's vector leg, and (b) the fused hybrid
 * rank using the real lexical leg from Postgres and the reference RRF fusion
 * from src/lib/retrieval — i.e. what production search_chunks would return.
 *
 * Reads the vector cache written by bench-embeddings.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fuseRrf, LEG_LIMIT } from "../src/lib/retrieval";
import { matchesTarget, type Target } from "./target-match";

const ROOT = path.resolve(__dirname, "..");
const CACHE = path.join(os.tmpdir(), "tramitico-bench-embeddings");
const CANARY = "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?";
// Index of the canary in bench-embeddings.ts QUESTIONS — keep in step.
const CANARY_INDEX = 1;

const TARGETS: Target[] = [
  { docKey: "reglamento-iva", articulo: "Artículo 11" },
  { docKey: "ley-iva", articulo: "Artículo 8" },
];

function loadDotEnvLocal() {
  const file = path.join(ROOT, ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function loadCache(provider: string, key: string): number[][] {
  const file = path.join(CACHE, `${provider}-${key}.jsonl`);
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as number[]);
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

async function main() {
  loadDotEnvLocal();
  const db = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  interface Chunk {
    id: string;
    doc_key: string;
    articulo: string | null;
  }
  const chunks: Chunk[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("chunks")
      .select("id, articulo, documents(doc_key)")
      .order("id")
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    for (const r of data) {
      chunks.push({
        id: r.id as string,
        doc_key: (r.documents as unknown as { doc_key: string }).doc_key,
        articulo: r.articulo as string | null,
      });
    }
    if (data.length < 1000) break;
  }

  const isTarget = (c: Chunk) => matchesTarget(c, TARGETS);

  // Real lexical leg: stub embedder + empty-vector call is not possible via
  // the RPC types here, so reproduce it with the same SQL shape the RPC uses —
  // vector leg disabled by passing null.
  const { data: lexData, error: lexError } = await db.rpc("search_chunks", {
    query_text: CANARY,
    query_embedding: null as unknown as string,
    match_count: LEG_LIMIT,
  });
  if (lexError) throw new Error(lexError.message);
  const lexicalIds = (lexData ?? []).map(
    (r: { chunk_id: string }) => r.chunk_id,
  );
  console.log(`lexical leg (${lexicalIds.length} rows):`);
  (lexData ?? [])
    .slice(0, 8)
    .forEach(
      (
        r: { doc_key: string; articulo: string | null; chunk_id: string },
        i: number,
      ) =>
        console.log(
          `  ${i + 1}. ${r.doc_key} · ${r.articulo ?? "—"}${isTarget({ id: r.chunk_id, doc_key: r.doc_key, articulo: r.articulo }) ? "  ← TARGET" : ""}`,
        ),
    );

  for (const provider of ["voyage"]) {
    const chunkVecs = loadCache(provider, "chunks");
    const questionVecs = loadCache(provider, "questions");
    const qv = questionVecs[CANARY_INDEX];
    const ranked = chunks
      .map((c, i) => ({ c, score: cosine(qv, chunkVecs[i]) }))
      .sort((a, b) => b.score - a.score);

    const targetRanks = ranked
      .map((r, i) => ({ ...r, rank: i + 1 }))
      .filter((r) => isTarget(r.c))
      .slice(0, 5);
    console.log(`\n${provider} vector leg — target ranks:`);
    for (const t of targetRanks) {
      console.log(
        `  #${t.rank}  ${t.c.doc_key} · ${t.c.articulo ?? "—"} (${t.score.toFixed(3)})`,
      );
    }

    const vectorIds = ranked.slice(0, LEG_LIMIT).map((r) => r.c.id);
    const fused = fuseRrf([vectorIds, lexicalIds]).slice(0, 8);
    const byId = new Map(chunks.map((c) => [c.id, c]));
    console.log(`${provider} hybrid (RRF) top-8:`);
    fused.forEach((f, i) => {
      const c = byId.get(f.id)!;
      console.log(
        `  ${i + 1}. ${c.doc_key} · ${c.articulo ?? "—"}${isTarget(c) ? "  ← TARGET" : ""}`,
      );
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
