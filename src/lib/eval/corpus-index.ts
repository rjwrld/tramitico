/**
 * The committed corpus index (issue #163): the distinct
 * `(docKey, articulo, path)` triples present in `public.chunks` after an
 * ingestion run, dumped to `eval/corpus-index.json`.
 *
 * Why it exists: the satisfiability census (#111) asserts every target in
 * `eval/dataset.jsonl` is matched by at least one ingested chunk. That is a
 * question about *coverage*, not about embeddings — but answering it against
 * the real table needs a corpus, and building a corpus needs the paid
 * embedder the per-PR lane is defined by not having. So a PR that edits the
 * dataset used to get no automated census at all. This fixture carries just
 * the columns `chunkMatchesTarget` reads, which makes the census a pure unit
 * test: a PR adding an unsatisfiable target goes red with no database and no
 * secrets.
 *
 * The trade is drift — the fixture goes stale when the corpus changes and
 * nobody re-dumps it. `scripts/ingest.ts` rewrites it on every run so the
 * common path can't drift, and the eval-lane census (against the real table,
 * which also compares the two) is the backstop for the uncommon one.
 */
import path from "node:path";
import type { MatchableChunk } from "./dataset";

export const CORPUS_INDEX_PATH = path.join(
  process.cwd(),
  "eval",
  "corpus-index.json",
);

export interface CorpusIndex {
  /** ISO timestamp of the ingestion run that produced this dump. */
  generatedAt: string;
  /** Rows in `public.chunks` at dump time — context for a stale-looking index. */
  chunkCount: number;
  /** Distinct `(docKey, articulo, path)` triples, in a stable order. */
  entries: MatchableChunk[];
}

function entryKey(chunk: MatchableChunk): string {
  return JSON.stringify([chunk.docKey, chunk.articulo, chunk.path]);
}

/** Distinct triples in a deterministic order, so a re-dump of an unchanged
 * corpus produces a byte-identical file and only real drift shows in a diff. */
export function buildCorpusIndex(
  chunks: readonly MatchableChunk[],
  generatedAt: string,
): CorpusIndex {
  const distinct = new Map<string, MatchableChunk>();
  for (const chunk of chunks) {
    const entry: MatchableChunk = {
      docKey: chunk.docKey,
      articulo: chunk.articulo,
      path: [...chunk.path],
    };
    distinct.set(entryKey(entry), entry);
  }
  const entries = [...distinct.values()].sort((a, b) =>
    entryKey(a).localeCompare(entryKey(b)),
  );
  return { generatedAt, chunkCount: chunks.length, entries };
}

export function serializeCorpusIndex(index: CorpusIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

export function parseCorpusIndex(json: string): CorpusIndex {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch (cause) {
    throw new Error("corpus index: malformed JSON", { cause });
  }
  const index = raw as Partial<CorpusIndex>;
  if (typeof index.generatedAt !== "string" || index.generatedAt === "") {
    throw new Error("corpus index: missing generatedAt");
  }
  if (typeof index.chunkCount !== "number") {
    throw new Error("corpus index: missing chunkCount");
  }
  if (!Array.isArray(index.entries) || index.entries.length === 0) {
    throw new Error("corpus index: missing entries");
  }
  for (const entry of index.entries as MatchableChunk[]) {
    if (typeof entry.docKey !== "string" || entry.docKey === "") {
      throw new Error("corpus index: entry missing docKey");
    }
    if (typeof entry.articulo !== "string" && entry.articulo !== null) {
      throw new Error(`corpus index: ${entry.docKey} entry missing articulo`);
    }
    if (
      !Array.isArray(entry.path) ||
      entry.path.some((element) => typeof element !== "string")
    ) {
      throw new Error(
        `corpus index: ${entry.docKey} entry has a non-string path`,
      );
    }
  }
  return index as CorpusIndex;
}

/** Above any plausible corpus size — the default PostgREST cap is 1000 rows,
 * and a silently truncated corpus would report false unsatisfiable targets. */
export const CHUNK_FETCH_LIMIT = 100_000;

/** The slice of `SupabaseClient` the census read needs (the `ReplaceRpcClient`
 * pattern, `src/lib/ingestion/replace.ts`). */
export interface ChunkCensusClient {
  from(table: "chunks"): {
    select(columns: string): {
      limit(count: number): PromiseLike<{
        data:
          | {
              articulo: string | null;
              path: string[];
              documents: { doc_key: string };
            }[]
          | null;
        error: { message: string } | null;
      }>;
    };
  };
}

/** The one census query, shared by the fixture dump and the eval-lane census
 * so the two can only ever disagree about the corpus, never about the read. */
export async function fetchCorpusChunks(
  client: ChunkCensusClient,
): Promise<MatchableChunk[]> {
  const { data, error } = await client
    .from("chunks")
    .select("articulo, path, documents!inner(doc_key)")
    .limit(CHUNK_FETCH_LIMIT);
  if (error) throw new Error(`chunk census query failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    docKey: row.documents.doc_key,
    articulo: row.articulo,
    path: row.path,
  }));
}
