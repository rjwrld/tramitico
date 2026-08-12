/**
 * Dataset satisfiability guard (issue #111): every expected target in
 * eval/dataset.jsonl must be satisfiable by at least one chunk actually
 * ingested into `public.chunks`.
 *
 * The hit-rate eval cannot catch this class. `caseHit` succeeds when *any one*
 * expected target is satisfied, so a multi-target case can carry a permanently
 * unsatisfiable target and stay green forever — the case measures the corpus
 * gap instead of answer quality. This sweep checks every target on its own.
 *
 * Env-gated on the database only — no embeddings, no retrieval, so it is far
 * cheaper than the hit-rate eval and CI stays green without secrets:
 *
 *   supabase start && pnpm ingest
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   pnpm test dataset-satisfiability
 *
 * Note the deliberate limit of this guard: a target with no `articulo` is
 * satisfied by any chunk of its document (`chunkMatchesTarget` returns early),
 * so it passes by construction. That is Class A only; whether the document's
 * text actually supports the case's claim is Class B — a judgment read, not a
 * predicate (see the PR for issue #111).
 */
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { serviceClient } from "../supabase/service";
import {
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
  type ExpectedTarget,
  type MatchableChunk,
} from "./dataset";

const hasDb = Boolean(
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY,
);

/** Above any plausible corpus size — the default PostgREST cap is 1000 rows,
 * and a silently truncated corpus would report false unsatisfiable targets. */
const CHUNK_FETCH_LIMIT = 100_000;

interface TargetCensusRow {
  caseId: string;
  target: ExpectedTarget;
  matchCount: number;
}

function describeTarget(target: ExpectedTarget): string {
  const parts = [target.docKey];
  if (target.articulo !== undefined) parts.push(target.articulo);
  if (target.pathIncludes !== undefined) parts.push(`@${target.pathIncludes}`);
  return parts.join(" · ");
}

describe.runIf(hasDb)(
  "eval dataset targets are satisfiable by the corpus",
  () => {
    const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
    const census: TargetCensusRow[] = [];

    beforeAll(async () => {
      const { data, error } = await serviceClient()
        .from("chunks")
        .select("articulo, path, documents!inner(doc_key)")
        .limit(CHUNK_FETCH_LIMIT);
      if (error) throw new Error(`chunk census query failed: ${error.message}`);
      const chunks: MatchableChunk[] = (data ?? []).map((row) => ({
        docKey: (row.documents as unknown as { doc_key: string }).doc_key,
        articulo: row.articulo,
        path: row.path,
      }));

      for (const evalCase of cases) {
        for (const target of evalCase.expected) {
          census.push({
            caseId: evalCase.id,
            target,
            matchCount: chunks.filter((chunk) =>
              chunkMatchesTarget(chunk, target),
            ).length,
          });
        }
      }

      const satisfied = census.filter((row) => row.matchCount > 0).length;
      console.log(
        `\ndataset target census (${chunks.length} chunks): ${satisfied}/${census.length} targets satisfiable`,
      );
      for (const row of census) {
        console.log(
          `  ${row.matchCount > 0 ? "ok  " : "MISS"}  ${String(row.matchCount).padStart(3)} chunk(s)  ${row.caseId}  →  ${describeTarget(row.target)}`,
        );
      }
    }, 60_000);

    it("has at least one ingested chunk for every expected target", () => {
      const unsatisfiable = census
        .filter((row) => row.matchCount === 0)
        .map((row) => `${row.caseId} → ${describeTarget(row.target)}`);
      expect(
        unsatisfiable,
        `expected targets no ingested chunk can satisfy:\n  ${unsatisfiable.join("\n  ")}`,
      ).toEqual([]);
    });
  },
);
