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
 * gate). Blocking gate: ≥90% pass, ratchet-only — and, since #324, every
 * `blocking` case individually, as SPEC §9 has said since #277.
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
  quotesDerivedFigure,
  resolveDerivedFigures,
  type ResolvedDerivedFigure,
} from "../answer/derived";
import {
  answerModelLabel,
  answerProviderOptions,
  getAnswerModel,
} from "../answer/model";
import {
  ANSWER_SYSTEM,
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
  TIER1_REQUIREMENT_FLOOR,
  checkLiterals,
  declineAdequacy,
  judgeAdequacy,
  judgedRequirements,
  requirementCoverage,
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
import {
  selectCases,
  subsetGateFailure,
  subsetSpec,
  SUBSET_ENV,
} from "./subset";
import { transcriptRow, writeTranscript } from "./transcript";
import {
  blockingGroundednessFailures,
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

const answerModelId = answerModelLabel();

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
  const allCases = retrievalCases(
    parseDataset(readFileSync(DATASET_PATH, "utf8")),
  );
  // #289: `EVAL_CASES` scopes the run to the cases someone named, so the
  // transcript that settles a classification costs cents instead of the whole
  // dataset. Read here and *asserted on* below — a scoped run measures no rate
  // and every gate says so rather than passing on a handful of cases.
  const subset = subsetSpec();
  const results: CaseResult[] = [];

  /**
   * The first line of every gate below. A scoped run answers a different
   * question from the one the gate asks, and #129's rule applies: a required
   * check that silently asserts nothing is the failure mode it exists to
   * prevent, so it fails, naming the scope, rather than passing on a handful
   * of cases.
   */
  function assertFullRun(): void {
    if (subset !== null) throw new Error(subsetGateFailure(subset));
  }

  beforeAll(async () => {
    // Before any paid call: an id that names no case is a typo that would
    // otherwise buy an empty table.
    const cases = selectCases(allCases, subset);
    if (subset !== null) {
      console.log(
        `\n${SUBSET_ENV}: ${cases.length}/${allCases.length} case(s) — ` +
          `${cases.map((c) => c.id).join(", ")}. Gates will fail: a subset ` +
          `run is a transcript read, not a measurement.`,
      );
    }
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
        await rerankChunks(query, retrieval.chunks, {
          expansion: retrieval.expansion,
          steps: retrieval.steps?.sentences ?? null,
        }),
        retrieval.chunks,
      );
      const derivedFigures = resolveDerivedFigures(chunks);
      const { text: answer } = await generateText({
        model: getAnswerModel(),
        providerOptions: answerProviderOptions(),
        system: ANSWER_SYSTEM,
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
        { answerModel: answerModelId, subset: subset !== null },
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

    // #287: the requirement-level count the Tier 1 gate reads
    // (TIER1_REQUIREMENT_FLOOR); the per-case read above cannot show a
    // change smaller than a whole case.
    const tier1Coverage = requirementCoverage(
      judgedForAdequacy.filter((r) => r.evalCase.tier === 1),
    );
    console.log(
      `tier 1 requirements stated (#287): ${tier1Coverage.stated}/${tier1Coverage.total}`,
    );

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

  // #287: the Tier 1 gate is the requirement count, not the per-case one —
  // see TIER1_REQUIREMENT_FLOOR. The per-case read (27/27 is the goal) is
  // printed above and named in the failure message.
  it(`states at least ${TIER1_REQUIREMENT_FLOOR} tier 1 requirements`, () => {
    assertFullRun();
    const tier1 = results.filter((r) => r.evalCase.tier === 1);
    const { stated, total } = requirementCoverage(tier1);
    const inadequate = tier1
      .filter(adequacyFailed)
      .map((r) => `${r.evalCase.id} (${adequacyReason(r)})`);
    expect(
      stated,
      `tier 1 requirements stated ${stated}/${total}; inadequate tier 1 answers: ${inadequate.join("; ")}`,
    ).toBeGreaterThanOrEqual(TIER1_REQUIREMENT_FLOOR);
  });

  it(`at least ${ADEQUACY_TIER2_GATE * 100}% of tier 2 cases with required claims are adequate`, () => {
    assertFullRun();
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
    assertFullRun();
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

  it("every blocking case's answer is supported by its retrieved chunks", () => {
    assertFullRun();
    // SPEC §9: «no individually blocking Tier 1 case may fail». Until #324
    // this lane asserted only the rate below, and the 2026-09-11 closing run
    // passed it with two Tier 1 held-out cases failing unanimously.
    const failed = blockingGroundednessFailures(results);
    expect(failed, `ungrounded blocking answers: ${failed.join("; ")}`).toEqual(
      [],
    );
  });

  it(`at least ${GROUNDEDNESS_GATE * 100}% of answers are supported by their retrieved chunks`, () => {
    assertFullRun();
    const failed = results
      .filter((r) => r.verdict === "fail")
      .map((r) => `${r.evalCase.id} (${r.reason})`);
    const passes = results.length - failed.length;
    expect(
      passes / results.length,
      `ungrounded answers: ${failed.join("; ")}`,
    ).toBeGreaterThanOrEqual(GROUNDEDNESS_GATE);
  });

  it("ships no answer whose derived figures are incompletely cited", () => {
    assertFullRun();
    // The deterministic owner of "a derived figure must be presented as a
    // derivation" (#263/#281). `route.ts` refuses such an answer at runtime —
    // one retry, then the honest decline — so an eval that never asked the
    // question was measuring less than production enforces. #289's A3 moved
    // the property here out of `ho-minimo-caja-independiente-2026`'s
    // `requiredClaims`, where it was a prose requirement put to a judge that
    // `ADEQUACY_SYSTEM_PROMPT` tells to score *presence*: it could only ever
    // have been answered by accident. Every case that resolves a figure, not
    // just F1.
    const failed = results
      .filter((r) => r.derivedFigures.length > 0)
      .flatMap((r) => {
        const incomplete = incompletelyCitedDerivedFigures(
          r.answer,
          r.derivedFigures,
        );
        return incomplete.length === 0
          ? []
          : [`${r.evalCase.id} (${incomplete.join(", ")})`];
      });
    expect(
      failed,
      `derived figures presented without their inputs: ${failed.join("; ")}`,
    ).toEqual([]);
  });

  it("answers F1 with both BMC figures and citations to every input", () => {
    assertFullRun();
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
      // The runtime check's reading of a quote (#403): ₡ counts, and a longer
      // number that starts with the figure does not.
      expect(
        quotesDerivedFigure(result!.answer, figure!),
        `${id} (${figure!.formattedValue}) is not quoted`,
      ).toBe(true);
      expect(
        incompletelyCitedDerivedFigures(result!.answer, [figure!]),
      ).toEqual([]);
    }
  });
});
