/**
 * Dataset satisfiability guard (issue #111) against the real `public.chunks`.
 *
 * The census itself lives in `satisfiability.ts` and runs per-PR over the
 * committed `eval/corpus-index.json` (#163). This lane is the backstop: it
 * runs the same sweep over the ingested table, and fails when the fixture no
 * longer describes it — the drift the committed dump can't notice on its own.
 *
 * Env-gated on the database only — no embeddings, no retrieval, so it is far
 * cheaper than the hit-rate eval. Skipped locally without credentials,
 * failed loudly on CI (#129):
 *
 *   supabase start && pnpm ingest
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   pnpm test dataset-satisfiability
 */
import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { serviceClient } from "../supabase/service";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import {
  buildCorpusIndex,
  type CensusChunk,
  collidingEntries,
  CORPUS_INDEX_PATH,
  describeEntry,
  fetchCorpusChunks,
  parseCorpusIndex,
} from "./corpus-index";
import { DATASET_PATH, parseDataset } from "./dataset";
import {
  censusTargets,
  formatCensus,
  type TargetCensusRow,
  unsatisfiableTargets,
} from "./satisfiability";

const describeEval = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

describeEval("eval dataset targets are satisfiable by the corpus", () => {
  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  let chunks: CensusChunk[] = [];
  let census: TargetCensusRow[] = [];

  beforeAll(async () => {
    chunks = await fetchCorpusChunks(serviceClient());
    census = censusTargets(cases, chunks);
    console.log(`\n${formatCensus(census, chunks.length)}`);
  }, 60_000);

  it("has at least one ingested chunk for every expected target", () => {
    const unsatisfiable = unsatisfiableTargets(census);
    expect(
      unsatisfiable,
      `expected targets no ingested chunk can satisfy:\n  ${unsatisfiable.join("\n  ")}`,
    ).toEqual([]);
  });

  // The per-PR lane checks this over the committed dump; here it is over the
  // table itself, so a corpus that drifted without a re-dump is still caught
  // (#274).
  it("gives every chunk a citation no other chunk carries", () => {
    const collisions = collidingEntries(
      buildCorpusIndex(chunks, new Date().toISOString()),
    );
    expect(
      collisions.map(describeEntry),
      "chunks sharing one (docKey, articulo, path, part) citation",
    ).toEqual([]);
  });

  it("has a committed corpus index that still describes the corpus", () => {
    const committed = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));
    const fresh = buildCorpusIndex(chunks, committed.generatedAt);
    expect(
      fresh,
      "eval/corpus-index.json no longer matches public.chunks — re-run `pnpm ingest` and commit the dump",
    ).toEqual(committed);
  });
});
