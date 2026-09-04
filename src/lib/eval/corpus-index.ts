/**
 * The committed corpus index (issue #163): the distinct
 * `(docKey, articulo, path)` triples present in `public.chunks` after an
 * ingestion run, dumped to `eval/corpus-index.json`, each with the number of
 * chunks and of distinct `part`s behind it (#274).
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

/** A chunk as the census reads it: the matchable triple plus its `part`, the
 * fourth column of the key a chunk's citation is supposed to identify (#274). */
export interface CensusChunk extends MatchableChunk {
  part: number;
}

/**
 * One distinct triple, with the two counts that make the uniqueness invariant
 * checkable from the dump alone (#274). A well-formed corpus splits a triple
 * into `part` 0…n-1 and nothing else, so `chunks` and `parts` agree; they
 * diverge exactly when two chunks were labelled with the same citation — one
 * artículo ingested under its neighbour's número.
 */
export interface CorpusIndexEntry extends MatchableChunk {
  /** Rows in `public.chunks` carrying this triple. */
  chunks: number;
  /** Distinct `part` values among them. */
  parts: number;
}

export interface CorpusIndex {
  /** ISO timestamp of the ingestion run that produced this dump. */
  generatedAt: string;
  /** Rows in `public.chunks` at dump time — context for a stale-looking index. */
  chunkCount: number;
  /** Distinct `(docKey, articulo, path)` triples, in a stable order. */
  entries: CorpusIndexEntry[];
}

function entryKey(chunk: MatchableChunk): string {
  return JSON.stringify([chunk.docKey, chunk.articulo, chunk.path]);
}

/** An entry rendered for an assertion message. */
export function describeEntry(entry: MatchableChunk): string {
  const parts = [entry.docKey, entry.articulo ?? "(sin artículo)"];
  if (entry.path.length > 0) parts.push(`@${entry.path.join(" › ")}`);
  return parts.join(" · ");
}

/**
 * The entries whose `(docKey, articulo, path, part)` key is carried by more
 * than one chunk — distinct artículos sharing one citation (#274).
 */
export function collidingEntries(index: CorpusIndex): CorpusIndexEntry[] {
  return index.entries.filter((entry) => entry.chunks !== entry.parts);
}

/** Distinct triples in a deterministic order, so a re-dump of an unchanged
 * corpus produces a byte-identical file and only real drift shows in a diff. */
export function buildCorpusIndex(
  chunks: readonly CensusChunk[],
  generatedAt: string,
): CorpusIndex {
  const distinct = new Map<string, CorpusIndexEntry>();
  const seenParts = new Map<string, Set<number>>();
  for (const chunk of chunks) {
    const key = entryKey(chunk);
    const entry = distinct.get(key) ?? {
      docKey: chunk.docKey,
      articulo: chunk.articulo,
      path: [...chunk.path],
      chunks: 0,
      parts: 0,
    };
    const parts = seenParts.get(key) ?? new Set<number>();
    parts.add(chunk.part);
    entry.chunks += 1;
    entry.parts = parts.size;
    seenParts.set(key, parts);
    distinct.set(key, entry);
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
  for (const entry of index.entries as CorpusIndexEntry[]) {
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
    for (const count of ["chunks", "parts"] as const) {
      if (!Number.isInteger(entry[count]) || entry[count] < 1) {
        throw new Error(`corpus index: ${entry.docKey} entry missing ${count}`);
      }
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
              part: number;
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
): Promise<CensusChunk[]> {
  const { data, error } = await client
    .from("chunks")
    .select("articulo, path, part, documents!inner(doc_key)")
    .limit(CHUNK_FETCH_LIMIT);
  if (error) throw new Error(`chunk census query failed: ${error.message}`);
  return (data ?? []).map((row) => ({
    docKey: row.documents.doc_key,
    articulo: row.articulo,
    path: row.path,
    part: row.part,
  }));
}
