/**
 * Groundedness eval (SPEC §9, issue #26): for every case in
 * eval/dataset.jsonl, run the production answer path — fused pool of
 * RERANK_POOL, Voyage rerank to top-8, then the answer model with the
 * production system prompt (ANSWER_MODEL, default Sonnet) — and ask an
 * LLM judge at temperature 0 whether the answer is supported by the
 * retrieved chunks. Failed items are re-judged twice more; the majority
 * verdict stands (absorbs judge flakiness at n≈25 without loosening the
 * gate). Blocking gate: ≥90% pass, ratchet-only.
 *
 * Env-gated like retrieval-hitrate.eval.test.ts, plus it needs an
 * Anthropic key for the answer + judge calls: skipped locally when any is
 * absent, failed loudly on CI (#129). Run locally with:
 *
 *   supabase start && pnpm ingest
 *   SUPABASE_URL=http://127.0.0.1:54321 \
 *   SUPABASE_SERVICE_ROLE_KEY=<service role key> \
 *   EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
 *   ANTHROPIC_API_KEY=<key> \
 *   pnpm vitest run src/lib/eval/groundedness.eval.test.ts
 *
 * Haiku comparison (SPEC §5, portfolio material): same command with
 * ANSWER_MODEL=claude-haiku-4-5 — the per-case table and pass rate print
 * with the run; record the numbers in eval/README.md.
 */
import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { beforeAll, expect, it } from "vitest";
import { getAnswerModel, DEFAULT_ANSWER_MODEL } from "../answer/model";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  WEAK_RETRIEVAL_ANSWER,
} from "../answer/prompt";
import { rerankChunks, RERANK_POOL } from "../answer/rerank";
import { createEmbedder, realEmbedderConfigured } from "../ingestion/embedder";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { retrieve } from "../retrieval";
import { DATASET_PATH, parseDataset, type EvalCase } from "./dataset";
import {
  GROUNDEDNESS_GATE,
  judgeAnswer,
  JUDGE_MODEL,
  type Verdict,
} from "./groundedness";

const REAL_EMBEDDINGS =
  "a real embeddings provider (EMBEDDINGS_PROVIDER + its API key)";
const describeEval = integrationSuite({
  ...envPrereqs(
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "ANTHROPIC_API_KEY",
  ),
  [REAL_EMBEDDINGS]: realEmbedderConfigured(),
});

const answerModelId = process.env.ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL;

interface CaseResult {
  evalCase: EvalCase;
  verdict: Verdict;
  /** One entry per judge call: 1 normally, 1 + REJUDGE_COUNT after a fail. */
  verdicts: Verdict[];
  reason: string;
  answer: string;
}

describeEval("groundedness (eval/dataset.jsonl)", () => {
  const embedder = createEmbedder();
  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const results: CaseResult[] = [];

  beforeAll(async () => {
    for (const evalCase of cases) {
      const retrieval = await retrieve(evalCase.question, {
        matchCount: RERANK_POOL,
        embedder,
      });

      // The production route streams the deterministic honest fallback on
      // weak retrieval without a model call — no claims, grounded by
      // construction. (The hit-rate eval separately asserts no legitimate
      // question is weak.)
      if (retrieval.isWeak) {
        results.push({
          evalCase,
          verdict: "pass",
          verdicts: [],
          reason: "weak-retrieval fallback (no model call)",
          answer: WEAK_RETRIEVAL_ANSWER,
        });
        continue;
      }

      const chunks = await rerankChunks(evalCase.question, retrieval.chunks);
      const { text: answer } = await generateText({
        model: getAnswerModel(),
        system: ANSWER_SYSTEM_PROMPT,
        prompt: buildUserPrompt(evalCase.question, chunks),
      });

      const judged = await judgeAnswer(evalCase.question, chunks, answer);
      results.push({ evalCase, ...judged, answer });
    }

    const passes = results.filter((r) => r.verdict === "pass").length;
    console.log(
      `\ngroundedness (answer=${answerModelId}, judge=${JUDGE_MODEL}): ` +
        `${passes}/${results.length}`,
    );
    for (const r of results) {
      const votes = r.verdicts.length > 1 ? ` [${r.verdicts.join("/")}]` : "";
      console.log(
        `  ${r.verdict === "pass" ? "pass" : "FAIL"}${votes}  ${r.evalCase.id}` +
          (r.verdict === "fail" ? `  — ${r.reason}` : ""),
      );
    }
    // Serial on purpose: shares the Voyage keyless-tier budget with the
    // hit-rate eval (3 requests/min) and keeps Anthropic usage tame.
  }, 5_400_000);

  it(`at least ${GROUNDEDNESS_GATE * 100}% of answers are supported by their retrieved chunks`, () => {
    const failed = results
      .filter((r) => r.verdict === "fail")
      .map((r) => `${r.evalCase.id} (${r.reason})`);
    const passes = results.length - failed.length;
    expect(
      passes / results.length,
      `ungrounded answers: ${failed.join("; ")}`,
    ).toBeGreaterThanOrEqual(GROUNDEDNESS_GATE);
  });
});
