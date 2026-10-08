/**
 * Cross-reference census (#508): every reference `crossReferences` reads in
 * the corpus, and whether the corpus holds the artículo it names. Free — one
 * read of `chunks` joined to `documents`, no provider call. Run it after a
 * change to the patterns or to the corpus, and read the `✗` lines and a
 * sample of the `✓` ones: a `✗` is a reference to an artículo the corpus did
 * not ingest (harmless, the lookup finds nothing), a wrong `✓` is a chunk the
 * pin would append for nothing.
 *
 *   pnpm cross-reference-census [--all]
 *   pnpm cross-reference-census --timing=<probe.json> [--repeat=N]
 *
 * Prints the totals, then the `✗` lines; `--all` prints every reference.
 *
 * `--timing` replays an `answer-set-probe` run's answer sets — the route's
 * configuration with the append off, `top8/capoff/pinon/xrefoff` — through
 * `crossReferencedChunks` and the real lookup, `--repeat` times each (default
 * 5), and prints p50/p95/max of the whole append and of the lookup alone,
 * over the asks whose set named anything. Free too: no model, no Voyage, only
 * the database `.env.local` points at — the local stack, so the numbers are
 * the query and PostgREST without production's network hop.
 *
 * Reads `.env.local` like `ingest.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { articuloKey } from "../src/lib/articulo-key";
import {
  articuloLookup,
  crossReferencedChunks,
  crossReferences,
  type ArticuloLookup,
} from "../src/lib/answer/cross-references";
import type { Database } from "../src/lib/database.types";
import type { DocumentSource, RetrievedChunk } from "../src/lib/retrieval";

/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

interface Row {
  id: string;
  articulo: string | null;
  part: number;
  content: string;
  path: string[] | null;
  documents: {
    doc_key: string;
    title: string;
    norma: string | null;
    source: unknown;
  };
}

async function corpus(db: SupabaseClient<Database>): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db
      .from("chunks")
      .select(
        "id, articulo, part, content, path, documents!inner(doc_key, title, norma, source)",
      )
      .range(from, from + 999);
    if (error) throw error;
    rows.push(...(data as unknown as Row[]));
    if (data.length < 1000) break;
  }
  return rows;
}

function census(rows: Row[]): void {
  const held = new Set(
    rows.map((r) => `${r.documents.doc_key}\u0000${articuloKey(r.articulo)}`),
  );
  const all = process.argv.includes("--all");
  let naming = 0;
  let references = 0;
  let resolvable = 0;
  const lines: string[] = [];
  for (const row of rows) {
    const found = crossReferences({
      docKey: row.documents.doc_key,
      articulo: row.articulo,
      part: row.part,
      content: row.content,
    });
    if (found.length > 0) naming += 1;
    for (const reference of found) {
      references += 1;
      const ok = held.has(`${reference.docKey}\u0000${reference.articulo}`);
      if (ok) resolvable += 1;
      if (ok && !all) continue;
      lines.push(
        `${ok ? "✓" : "✗"} ${row.documents.doc_key}·${row.articulo}#${row.part} → ${reference.docKey}·${reference.articulo}`,
      );
    }
  }
  console.log(
    `chunks ${rows.length}, naming an artículo ${naming}, references ${references}, held by the corpus ${resolvable}`,
  );
  console.log(lines.join("\n"));
}

function toChunk(row: Row): RetrievedChunk {
  return {
    chunkId: row.id,
    docKey: row.documents.doc_key,
    docTitle: row.documents.title,
    norma: row.documents.norma,
    articulo: row.articulo,
    path: row.path ?? [],
    part: row.part,
    content: row.content,
    source: (row.documents.source ?? {}) as DocumentSource,
    fetchedAt: null,
    score: 0,
    vectorRank: null,
    lexicalRank: null,
  };
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)];
}

function summary(label: string, ms: number[]): string {
  const sorted = [...ms].sort((a, b) => a - b);
  const f = (n: number) => `${n.toFixed(1)} ms`;
  return `${label}: n=${sorted.length} p50 ${f(quantile(sorted, 0.5))} · p95 ${f(quantile(sorted, 0.95))} · max ${f(sorted[sorted.length - 1])}`;
}

/** The probe configuration the append runs on: production's, append off. */
const BASE_CONFIG = "top8/capoff/pinon/xrefoff";

async function timing(
  db: SupabaseClient<Database>,
  rows: Row[],
  file: string,
): Promise<void> {
  const repeat = Number(arg("repeat") ?? "5");
  const byLabel = new Map(
    rows.map((row) => [
      `${row.documents.doc_key}·${row.articulo ?? "*"}·#${row.part}`,
      toChunk(row),
    ]),
  );
  const probe = JSON.parse(readFileSync(file, "utf8")) as {
    reads: { id: string; per: Record<string, { set: string[] } | undefined> }[];
  };
  const real = articuloLookup(db);
  const lookupMs: number[] = [];
  const timed: ArticuloLookup = async (references, signal) => {
    const start = performance.now();
    try {
      return await real(references, signal);
    } finally {
      lookupMs.push(performance.now() - start);
    }
  };
  const appendMs: number[] = [];
  let sets = 0;
  let missing = 0;
  for (const read of probe.reads) {
    const labels = read.per[BASE_CONFIG]?.set;
    if (labels === undefined) continue;
    const set = labels.flatMap((label) => byLabel.get(label) ?? []);
    if (set.length < labels.length) missing += 1;
    sets += 1;
    for (let r = 0; r < repeat; r += 1) {
      const before = lookupMs.length;
      const start = performance.now();
      await crossReferencedChunks(set, { lookup: timed });
      // Only the asks that read the database: a set that names nothing
      // costs the parse alone, and is counted apart.
      if (lookupMs.length > before) appendMs.push(performance.now() - start);
    }
  }
  console.log(
    `answer sets ${sets} from ${file} (${missing} with a chunk the corpus no longer carries), ${repeat} runs each`,
  );
  console.log(summary("append, asks that read the database", appendMs));
  console.log(summary("lookup alone", lookupMs));
  console.log(
    `asks that read the database: ${appendMs.length / repeat}/${sets}`,
  );
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const db = createClient<Database>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const rows = await corpus(db);
  const file = arg("timing");
  if (file === undefined) census(rows);
  else await timing(db, rows, file);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
