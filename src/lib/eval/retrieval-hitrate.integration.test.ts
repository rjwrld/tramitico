/**
 * Retrieval hit-rate eval (SPEC §9, issue #25): for every case in
 * eval/dataset.jsonl, run the production retrieval path — fused pool of
 * RERANK_POOL, then the optional Voyage rerank, exactly as /api/ask does —
 * and assert the expected artículo lands in the answer top-k. Catches
 * chunking/retrieval regressions independently of generation.
 *
 * Env-gated like retrieval.integration.test.ts: skipped locally without a
 * database and real embeddings; on CI a missing prerequisite fails the eval
 * job rather than skipping (#129). Run locally with:
 *
 *   supabase start && pnpm ingest
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
 *   pnpm test
 *
 * Reranking defaults on (#25 validated the lift); RERANK=off measures the
 * fused-only baseline.
 */
import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { rerankChunks, RERANK_POOL } from "../answer/rerank";
import { createEmbedder, realEmbedderConfigured } from "../ingestion/embedder";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { retrieve, type RetrievedChunk } from "../retrieval";
import {
  caseHit,
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
  type EvalCase,
} from "./dataset";

/**
 * Hit-rate gate (expected artículo in answer top-k). Baseline measured
 * 2026-08-06 on the 793-chunk voyage-3 corpus: 25/25 reranked (the default),
 * 19/25 fused-only. Gate sits below the reranked score to absorb single-case
 * embedding jitter, and above the fused-only score so CI still catches a
 * silently disabled reranker. Ratchet up, never down.
 */
export const HIT_RATE_GATE = 0.92;

const REAL_EMBEDDINGS =
  "a real embeddings provider (EMBEDDINGS_PROVIDER + its API key)";
const describeEval = integrationSuite({
  ...envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
  [REAL_EMBEDDINGS]: realEmbedderConfigured(),
});

interface CaseResult {
  evalCase: EvalCase;
  hit: boolean;
  /** 1-based rank of the first expected chunk in the fused pool; null = not in pool. */
  poolRank: number | null;
  topScore: number;
  isWeak: boolean;
}

describeEval("retrieval hit-rate (eval/dataset.jsonl)", () => {
  const embedder = createEmbedder();
  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const results: CaseResult[] = [];
  const rerankMode = process.env.RERANK || "voyage";

  beforeAll(async () => {
    for (const evalCase of cases) {
      const retrieval = await retrieve(evalCase.question, {
        matchCount: RERANK_POOL,
        embedder,
      });
      const topK = await rerankChunks(evalCase.question, retrieval.chunks);
      const inPool = (chunk: RetrievedChunk) =>
        evalCase.expected.some((t) => chunkMatchesTarget(chunk, t));
      const poolIndex = retrieval.chunks.findIndex(inPool);
      results.push({
        evalCase,
        hit: caseHit(topK, evalCase.expected),
        poolRank: poolIndex === -1 ? null : poolIndex + 1,
        topScore: retrieval.topScore,
        isWeak: retrieval.isWeak,
      });
    }
    const hits = results.filter((r) => r.hit).length;
    console.log(
      `\nretrieval hit-rate (rerank=${rerankMode}): ${hits}/${results.length}`,
    );
    for (const r of results) {
      console.log(
        `  ${r.hit ? "hit " : "MISS"}  pool#${r.poolRank ?? "—"}  top=${r.topScore.toFixed(4)}  ${r.evalCase.id}`,
      );
    }
    // Serial on purpose: each distinct question is one Voyage embed (plus
    // one rerank call), and the keyless tier is 3 requests/min.
  }, 2_700_000);

  it("finds every blocking case's artículo in the answer top-k", () => {
    const failed = results
      .filter((r) => r.evalCase.blocking && !r.hit)
      .map((r) => r.evalCase.id);
    expect(failed, `blocking eval cases missed: ${failed.join(", ")}`).toEqual(
      [],
    );
  });

  it(`hits at least ${HIT_RATE_GATE * 100}% of expected artículos in the answer top-k`, () => {
    const hits = results.filter((r) => r.hit).length;
    expect(hits / results.length).toBeGreaterThanOrEqual(HIT_RATE_GATE);
  });

  it("never trips the weak-retrieval fallback on a legitimate question", () => {
    // Corroboration referee (#25 charter, isCorroborated in retrieval.ts):
    // every eval question is answerable from the corpus, so none may be
    // "weak".
    const weak = results.filter((r) => r.isWeak).map((r) => r.evalCase.id);
    expect(
      weak,
      `legitimate questions flagged weak: ${weak.join(", ")}`,
    ).toEqual([]);
  });
});
