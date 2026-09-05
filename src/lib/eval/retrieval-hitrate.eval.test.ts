/**
 * Retrieval hit-rate eval (SPEC §9, issue #25): for every case in
 * eval/dataset.jsonl, run the production retrieval path — fused pool of
 * RERANK_POOL, then the optional Voyage rerank, exactly as /api/ask does —
 * and assert the expected artículo lands in the answer top-k. Catches
 * chunking/retrieval regressions independently of generation.
 *
 * Since #132 a case may carry `history`, making its question a follow-up:
 * those are condensed first, by the same `condenseQuestion` the route calls,
 * and the retrieval is measured against the standalone result. That is what
 * the extra Anthropic key below is for.
 *
 * Env-gated like retrieval.eval.test.ts: skipped locally without a
 * database and real embeddings; on CI a missing prerequisite fails the eval
 * job rather than skipping (#129). Run locally with:
 *
 *   supabase start && pnpm ingest
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
 *   ANTHROPIC_API_KEY=<key> \
 *   pnpm test
 *
 * Reranking defaults on (#25 validated the lift); RERANK=off measures the
 * fused-only baseline.
 *
 * #287 adds the knobs a measured run needs instead of a guess — `RERANK_MODEL`
 * (a reranker with different Spanish legal recall), `ANSWER_TOP_K` (a larger
 * answer set) and `PIN_DERIVED_INPUTS=off` (the derived-input pin removed) —
 * and prints, for every miss whose target did reach the fused pool, the rank
 * the reranker gave it, the answer set that beat it, and the chunk holding
 * the last surviving place.
 */
import { readFileSync } from "node:fs";
import { beforeAll, expect, it } from "vitest";
import { condenseQuestion } from "../answer/condense";
import { pinDerivedFigureInputs } from "../answer/derived";
import {
  answerSetFromOrder,
  answerTopK,
  RERANK_MODEL,
  RERANK_POOL,
  rerankOrder,
  type RerankedChunk,
} from "../answer/rerank";
import { createEmbedder, realEmbedderConfigured } from "../ingestion/embedder";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { retrieve, type RetrievedChunk } from "../retrieval";
import {
  caseHit,
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
  retrievalCases,
  type EvalCase,
} from "./dataset";
import { formatExposureTally, tallyByExposure } from "./exposure";

/**
 * Hit-rate gate (expected artículo in answer top-k). Set 2026-08-06 on the
 * 793-chunk corpus (25/25 reranked, 19/25 fused-only): below the reranked
 * score to absorb single-case embedding jitter, above the fused-only score so
 * a silently disabled reranker still fails. Ratchet up, never down.
 *
 * The 2026 baseline (#267, 73 cases on the beta corpus) measured 63/73 with
 * rerank and 52/73 fused-only — under this gate, and left here on purpose:
 * the ten misses are classified in #286 (fused pool) and #287 (rerank cut),
 * and the gate is what keeps them from being forgotten. eval/README.md has
 * the per-case table and the ratchet rule.
 */
export const HIT_RATE_GATE = 0.92;

const REAL_EMBEDDINGS =
  "a real embeddings provider (EMBEDDINGS_PROVIDER + its API key)";
// ANTHROPIC_API_KEY since #132: the condensation cases in the dataset are
// resolved by a real model call, exactly as /api/ask resolves them. Without
// the key those cases would silently fall back to their raw follow-up
// ("¿Y si también soy asalariado?"), MISS, and report a retrieval regression
// that is really a missing credential.
const describeEval = integrationSuite({
  ...envPrereqs(
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
  ),
  [REAL_EMBEDDINGS]: realEmbedderConfigured(),
});

function describeChunk(chunk: RetrievedChunk): string {
  return `${chunk.docKey} · ${chunk.articulo ?? "—"}`;
}

interface CaseResult {
  evalCase: EvalCase;
  hit: boolean;
  /** 1-based rank of the first expected chunk in the fused pool; null = not in pool. */
  poolRank: number | null;
  /** Same, in the reranked order; null when nothing reranked (RERANK=off, no key). */
  rerankRank: number | null;
  /** The reranked answer set, kept for the #287 displacement report on a miss. */
  answerSet: RetrievedChunk[];
  /** The chunk that took the last answer-set place a missed target wanted. */
  displacedBy: RerankedChunk | null;
  topScore: number;
  isWeak: boolean;
  /** The standalone question a condensation case was run on (#132); null otherwise. */
  condensed: string | null;
}

describeEval("retrieval hit-rate (eval/dataset.jsonl)", () => {
  // An abstention case has no correct source by construction (#261), so it
  // has nothing to hit and *should* trip the weak-retrieval fallback — the
  // opposite of what every assertion below says. It is judged in its own lane.
  const cases = retrievalCases(
    parseDataset(readFileSync(DATASET_PATH, "utf8")),
  );
  const results: CaseResult[] = [];
  const rerankMode = process.env.RERANK || "voyage";
  const topKSize = answerTopK();

  beforeAll(async () => {
    // Constructed here, not in the describe body: `describe.skip` still runs
    // its callback, so a constructor that throws without the environment
    // would crash the file on the gate's skip path (#129).
    const embedder = createEmbedder();
    for (const evalCase of cases) {
      // The route's own first step (#132): a case carrying `history` is a
      // follow-up, and what the pipeline sees is the standalone rewrite. A
      // case without history skips the call entirely, so single-turn cases
      // measure exactly what they measured before.
      const { query, condensed } = await condenseQuestion(
        evalCase.question,
        evalCase.history ?? [],
      );
      const retrieval = await retrieve(query, {
        matchCount: RERANK_POOL,
        embedder,
      });
      const order = await rerankOrder(query, retrieval.chunks);
      // The route's exact sequence: rerank cut, then #287's derived-input pin.
      const topK = pinDerivedFigureInputs(
        answerSetFromOrder(order, retrieval.chunks),
        retrieval.chunks,
      );
      const inPool = (chunk: RetrievedChunk) =>
        evalCase.expected.some((t) => chunkMatchesTarget(chunk, t));
      const poolIndex = retrieval.chunks.findIndex(inPool);
      const rerankIndex =
        order === null ? -1 : order.findIndex((r) => inPool(r.chunk));
      // Requirement 1 of #287: the marginal survivor — the chunk holding the
      // last answer-set place — is what a target ranked below it lost to.
      const marginal = order === null ? undefined : order[topKSize - 1];
      results.push({
        evalCase,
        hit: caseHit(topK, evalCase.expected),
        poolRank: poolIndex === -1 ? null : poolIndex + 1,
        rerankRank: rerankIndex === -1 ? null : rerankIndex + 1,
        answerSet: topK,
        displacedBy:
          marginal !== undefined && rerankIndex >= topKSize ? marginal : null,
        topScore: retrieval.topScore,
        isWeak: retrieval.isWeak,
        condensed,
      });
    }
    const hits = results.filter((r) => r.hit).length;
    console.log(
      `\nretrieval hit-rate (rerank=${rerankMode} ${process.env.RERANK_MODEL || RERANK_MODEL}, pool ${RERANK_POOL} → top ${topKSize}, ` +
        `pin=${process.env.PIN_DERIVED_INPUTS || "on"}): ${hits}/${results.length}`,
    );
    for (const r of results) {
      console.log(
        `  ${r.hit ? "hit " : "MISS"}  pool#${r.poolRank ?? "—"}  top=${r.topScore.toFixed(4)}  ${r.evalCase.id}` +
          // A missed condensation case is usually a bad rewrite rather than a
          // retrieval regression, and the rewrite is the only way to tell.
          (r.condensed === null ? "" : `\n        ↳ ${r.condensed}`),
      );
    }
    // #287: a target that reached the pool and still missed was cut by the
    // rerank, and the report has to say by what — the reranked order the case
    // actually produced, and the chunk holding the last surviving place.
    for (const r of results.filter((r) => !r.hit && r.poolRank !== null)) {
      console.log(`\n  cut between pool and top-${topKSize}: ${r.evalCase.id}`);
      console.log(
        `    target reranked #${r.rerankRank ?? "—"} (pool #${r.poolRank})` +
          (r.displacedBy === null
            ? ""
            : `, displaced by ${describeChunk(r.displacedBy.chunk)} (score ${r.displacedBy.score.toFixed(4)})`),
      );
      r.answerSet.forEach((chunk, index) => {
        console.log(`    #${index + 1} ${describeChunk(chunk)}`);
      });
    }
    console.log(
      formatExposureTally(
        "hit-rate",
        tallyByExposure(
          results,
          (r) => r.evalCase,
          (r) => r.hit,
        ),
      ),
    );
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
