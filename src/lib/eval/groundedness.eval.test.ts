/**
 * (Since #132, a case carrying `history` is condensed first — the pipeline
 * below runs on the standalone question, as the route does.)
 *
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
import { condenseQuestion } from "../answer/condense";
import {
  incompletelyCitedDerivedFigures,
  pinDerivedFigureInputs,
  resolveDerivedFigures,
  type ResolvedDerivedFigure,
} from "../answer/derived";
import { getAnswerModel, DEFAULT_ANSWER_MODEL } from "../answer/model";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
  WEAK_RETRIEVAL_ANSWER,
} from "../answer/prompt";
import { rerankChunks, RERANK_POOL } from "../answer/rerank";
import { createEmbedder, realEmbedderConfigured } from "../ingestion/embedder";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { retrieve, type RetrievedChunk } from "../retrieval";
import { validateCitations, type CitationVerdict } from "../answer/invariant";
import {
  ADEQUACY_TIER2_GATE,
  checkLiterals,
  declineAdequacy,
  judgeAdequacy,
  judgedRequirements,
  literalFailures,
  type AdequacyOutcome,
} from "./adequacy";
import {
  DATASET_PATH,
  parseDataset,
  retrievalCases,
  type EvalCase,
} from "./dataset";
import { formatExposureTally, tallyByExposure } from "./exposure";
import { transcriptRow, writeTranscript } from "./transcript";
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
  /** The standalone question the pipeline ran (#132) — the case's own, unless
   * it carries `history`. */
  query: string;
  /** The chunks the prompt numbered, so a transcript row can resolve `[n]`.
   * Empty on a weak-retrieval decline, which makes no model call. */
  chunks: readonly RetrievedChunk[];
  verdict: Verdict;
  /** One entry per judge call: 1 normally, 1 + REJUDGE_COUNT after a fail. */
  verdicts: Verdict[];
  reason: string;
  answer: string;
  /**
   * The runtime citation invariant, run over the eval's own answers (#168).
   * The harness used to bypass it entirely, so an answer citing nothing —
   * which the route would have retried and then refused to ship — could score
   * a groundedness pass here. `null` on a weak-retrieval decline, which the
   * route streams without markers by construction.
   */
  citations: CitationVerdict | null;
  /** Absent on a case that declares no requiredClaims/requiredSteps. */
  adequacy: (AdequacyOutcome & { literals: string[] }) | null;
  derivedFigures: ResolvedDerivedFigure[];
}

/**
 * The adequacy verdict for a case the pipeline declined on weak retrieval:
 * every requirement missing, no judge call, `null` for a case that declares
 * none (#261 req. 2).
 */
function requirementsOf(
  evalCase: EvalCase,
): (AdequacyOutcome & { literals: string[] }) | null {
  if (
    evalCase.requiredClaims === undefined &&
    evalCase.requiredSteps === undefined
  ) {
    return null;
  }
  return {
    ...declineAdequacy(judgedRequirements(evalCase)),
    literals: literalFailures(
      checkLiterals(WEAK_RETRIEVAL_ANSWER, evalCase.requiredClaims ?? []),
    ),
  };
}

/** Adequacy fails when a judged requirement or a literal check fails. */
function adequacyFailed(result: CaseResult): boolean {
  return (
    result.adequacy !== null &&
    (result.adequacy.verdict === "fail" || result.adequacy.literals.length > 0)
  );
}

function adequacyReason(result: CaseResult): string {
  const parts = [
    ...(result.adequacy?.missing ?? []),
    ...(result.adequacy?.literals ?? []),
  ];
  return parts.join("; ");
}

describeEval("groundedness (eval/dataset.jsonl)", () => {
  // Abstention cases have no correct source and must not be answered at all;
  // they are judged in their own lane (`abstention.eval.test.ts`), not by a
  // judge asking whether their answer was supported.
  const cases = retrievalCases(
    parseDataset(readFileSync(DATASET_PATH, "utf8")),
  );
  const results: CaseResult[] = [];

  beforeAll(async () => {
    // Constructed here, not in the describe body: `describe.skip` still runs
    // its callback, so a constructor that throws without the environment
    // would crash the file on the gate's skip path (#129).
    const embedder = createEmbedder();
    for (const evalCase of cases) {
      // #132: a case carrying `history` is a follow-up, and the whole
      // pipeline below — retrieval, rerank, the answer prompt and the judge —
      // sees the condensed standalone question, exactly as /api/ask does. A
      // case without history makes no condensation call at all.
      const { query } = await condenseQuestion(
        evalCase.question,
        evalCase.history ?? [],
      );
      const retrieval = await retrieve(query, {
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
          query,
          chunks: [],
          verdict: "pass",
          verdicts: [],
          reason: "weak-retrieval fallback (no model call)",
          answer: WEAK_RETRIEVAL_ANSWER,
          citations: null,
          // …but a decline is never *adequate* on a case that declares
          // required claims: the satisfiability census says the corpus can
          // answer it, so declining is a product failure groundedness cannot
          // see (#261 req. 2).
          adequacy: requirementsOf(evalCase),
          derivedFigures: [],
        });
        continue;
      }

      const chunks = pinDerivedFigureInputs(
        await rerankChunks(query, retrieval.chunks),
        retrieval.chunks,
      );
      const derivedFigures = resolveDerivedFigures(chunks);
      const { text: answer } = await generateText({
        model: getAnswerModel(),
        system: ANSWER_SYSTEM_PROMPT,
        prompt: buildUserPrompt(query, chunks, { derivedFigures }),
      });

      // Judged against the same question the answer was written for: asking
      // "is this supported?" about a bare "¿Y si también soy asalariado?"
      // would judge the condensation, not the groundedness.
      const judged = await judgeAnswer(
        query,
        chunks,
        answer,
        undefined,
        derivedFigures,
      );
      const requirements = judgedRequirements(evalCase);
      const declaresRequirements =
        evalCase.requiredClaims !== undefined ||
        evalCase.requiredSteps !== undefined;
      results.push({
        evalCase,
        query,
        chunks,
        ...judged,
        answer,
        derivedFigures,
        citations: validateCitations(answer, chunks.length),
        adequacy: declaresRequirements
          ? {
              ...(await judgeAdequacy(query, requirements, answer)),
              literals: literalFailures(
                checkLiterals(answer, evalCase.requiredClaims ?? []),
              ),
            }
          : null,
      });
    }

    // #289 req. 1: the run leaves its answers behind. The printed table says
    // *which* requirements were missing and can never say why — the answer and
    // the numbered chunk list are what separate «the answer omitted it» from
    // «the fragment was not in the top-8» from «the requirement over-specifies
    // what the corpus carries». Reporting only: nothing below reads the file,
    // and a write failure must not turn a measured run into a red one.
    try {
      const transcript = writeTranscript(
        results.map((r) =>
          transcriptRow({
            evalCase: r.evalCase,
            query: r.query,
            answer: r.answer,
            chunks: r.chunks,
            derivedFigures: r.derivedFigures,
            groundedness: {
              verdict: r.verdict,
              verdicts: r.verdicts,
              reason: r.reason,
            },
            citations: r.citations,
            adequacy:
              r.adequacy === null
                ? null
                : {
                    verdict: r.adequacy.verdict,
                    missing: r.adequacy.missing,
                    literals: r.adequacy.literals,
                  },
          }),
        ),
        { answerModel: answerModelId },
      );
      console.log(`\ntranscript (#289): ${transcript}`);
    } catch (error) {
      console.log(`\ntranscript (#289): not written — ${String(error)}`);
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

    console.log(
      formatExposureTally(
        "groundedness",
        tallyByExposure(
          results,
          (r) => r.evalCase,
          (r) => r.verdict === "pass",
        ),
      ),
    );

    const judgedForAdequacy = results.filter((r) => r.adequacy !== null);
    console.log(
      `\nadequacy (#130): ` +
        `${judgedForAdequacy.filter((r) => !adequacyFailed(r)).length}/` +
        `${judgedForAdequacy.length}`,
    );
    for (const r of judgedForAdequacy) {
      console.log(
        `  ${adequacyFailed(r) ? "FAIL" : "pass"}  tier ${r.evalCase.tier}` +
          `  ${r.evalCase.family ?? "—"}  ${r.evalCase.id}` +
          (adequacyFailed(r) ? `  — missing: ${adequacyReason(r)}` : ""),
      );
    }

    console.log(
      formatExposureTally(
        "adequacy",
        tallyByExposure(
          judgedForAdequacy,
          (r) => r.evalCase,
          (r) => !adequacyFailed(r),
        ),
      ),
    );

    const violations = results.filter(
      (r) => r.citations !== null && !r.citations.ok,
    );
    console.log(
      `\ncitation invariant (#168): ${violations.length} violation(s)`,
    );
    for (const r of violations) {
      const verdict = r.citations as Exclude<CitationVerdict, { ok: true }>;
      console.log(
        `  ${verdict.violation}  ${r.evalCase.id}` +
          (verdict.unresolved.length > 0
            ? `  unresolved=${verdict.unresolved.join(",")}`
            : ""),
      );
    }
    // Serial on purpose: shares the Voyage keyless-tier budget with the
    // hit-rate eval (3 requests/min) and keeps Anthropic usage tame.
  }, 5_400_000);

  it("every tier 1 case states all of its required claims and steps", () => {
    const failed = results
      .filter((r) => r.evalCase.tier === 1 && adequacyFailed(r))
      .map((r) => `${r.evalCase.id} (${adequacyReason(r)})`);
    expect(failed, `inadequate tier 1 answers: ${failed.join("; ")}`).toEqual(
      [],
    );
  });

  it(`at least ${ADEQUACY_TIER2_GATE * 100}% of tier 2 cases with required claims are adequate`, () => {
    const tier2 = results.filter(
      (r) => r.evalCase.tier === 2 && r.adequacy !== null,
    );
    const failed = tier2
      .filter(adequacyFailed)
      .map((r) => `${r.evalCase.id} (${adequacyReason(r)})`);
    const rate =
      tier2.length === 0 ? 1 : (tier2.length - failed.length) / tier2.length;
    expect(
      rate,
      `inadequate tier 2 answers: ${failed.join("; ")}`,
    ).toBeGreaterThanOrEqual(ADEQUACY_TIER2_GATE);
  });

  it("ships no answer the runtime citation invariant would refuse", () => {
    // The 2026 baseline (#267) measured 0 violations over all 73 answers, so
    // the threshold the #195 backlog was waiting for is zero, on every case —
    // not only the blocking ones it was asserted on until then.
    const failed = results
      .filter((r) => r.citations !== null && !r.citations.ok)
      .map(
        (r) =>
          `${r.evalCase.id} (${(r.citations as Exclude<CitationVerdict, { ok: true }>).violation})`,
      );
    expect(failed, `citation violations: ${failed.join("; ")}`).toEqual([]);
  });

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

  it("answers F1 with both BMC figures and citations to every input", () => {
    const result = results.find(
      ({ evalCase }) => evalCase.id === "ccss-cuanto-pago-base",
    );
    expect(result, "missing F1 eval case").toBeDefined();
    expect(result!.verdict).toBe("pass");

    for (const id of ["bmc-ivm-2026", "bmc-sem-2026"]) {
      const figure = result!.derivedFigures.find(
        (candidate) => candidate.id === id,
      );
      expect(
        figure,
        `${id} was not resolved from the answer chunks`,
      ).toBeDefined();
      expect(result!.answer).toContain(figure!.formattedValue);
      expect(
        incompletelyCitedDerivedFigures(result!.answer, [figure!]),
      ).toEqual([]);
    }
  });
});
