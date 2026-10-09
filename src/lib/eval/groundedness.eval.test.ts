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
 * gate). Since #474 (ADR 0023's amendment) the count of grounded answers is a
 * tracked baseline that fails below `GROUNDEDNESS_FLOOR`, and every
 * `blocking` case is read on up to three answers: one whose first answer
 * fails is asked twice more, and fails on two of the three. A false
 * corpus-absence claim (#500) fails its case on whichever answer makes it.
 * Each failure the judges made carries a contradiction/inference label,
 * recorded and never gated.
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
 *
 * #502's robustness block is answered and judged with every other case, and
 * every gate below reads the cases it read before the block existed, so its
 * baselines still compare. The block prints its own lines — groundedness,
 * adequacy, requirements stated — under each headline (`./robustness`).
 */
import { readFileSync } from "node:fs";
import { generateText } from "ai";
import { beforeAll, expect, it } from "vitest";
import {
  incompletelyCitedDerivedFigures,
  quotesDerivedFigure,
  resolveDerivedFigures,
  type ResolvedDerivedFigure,
} from "../answer/derived";
import { pinAnswerSet } from "../answer/pins";
import {
  ANSWER_MAX_OUTPUT_TOKENS,
  answerModelLabel,
  answerProviderOptions,
  getAnswerModel,
} from "../answer/model";
import { generationFinishReason } from "../telemetry";
import {
  ANSWER_SYSTEM,
  buildUserPrompt,
  WEAK_RETRIEVAL_ANSWER,
} from "../answer/prompt";
import { crDate } from "../cr-time";
import {
  rerankChunks,
  rerankOptionsFor,
  RERANK_POOL,
  type RerankReadingCount,
} from "../answer/rerank";
import {
  createEmbedder,
  realEmbedderConfigured,
  type Embedder,
} from "../ingestion/embedder";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { scopedLane } from "./scoped-lane";
import { retrieve, type RetrievedChunk } from "../retrieval";
import { validateCitations, type CitationVerdict } from "../answer/invariant";
import {
  ADEQUACY_TIER2_GATE,
  TIER1_REGRESSION_MARGIN,
  TIER1_REQUIREMENT_BASELINE,
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
import {
  checkAnswer,
  falseAbsenceFailures,
  formatAnswerChecks,
  withAbsenceGate,
  type AnswerChecks,
  type CheckedCase,
} from "./answer-checks";
import { formatExposureTally, tallyByExposure } from "./exposure";
import { formatRobustnessLine, splitRobustness } from "./robustness";
import { rewriteCase, rewritesFromEnv, type CaseRewrites } from "./rewrites";
import {
  selectCases,
  subsetGateFailure,
  subsetSpec,
  SUBSET_ENV,
} from "./subset";
import {
  droppedReadingsSummary,
  transcriptRow,
  writeTranscript,
  runThenRecord,
  type TranscriptGroundedness,
  type TranscriptGeneration,
} from "./transcript";
import {
  BLOCKING_REASK_COUNT,
  blockingCaseVerdict,
  blockingGroundednessFailures,
  GROUNDEDNESS_BASELINE,
  GROUNDEDNESS_CASES,
  GROUNDEDNESS_FLOOR,
  GROUNDEDNESS_REGRESSION_MARGIN,
  judgeAnswer,
  JUDGE_MODEL,
  labelFailure,
  needsReask,
  type BlockingCase,
  type FailureLabel,
  type FailureLabelling,
  scoreAnswer,
  type Verdict,
} from "./groundedness";

const REAL_EMBEDDINGS =
  "a real embeddings provider (EMBEDDINGS_PROVIDER + its API key)";
const DATASET = parseDataset(readFileSync(DATASET_PATH, "utf8"));
// #536: `EVAL_CASES` naming none of this lane's cases skips it.
const describeEval = scopedLane(
  integrationSuite({
    ...envPrereqs(
      "SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "ANTHROPIC_API_KEY",
    ),
    [REAL_EMBEDDINGS]: realEmbedderConfigured(),
  }),
  retrievalCases(DATASET),
);

const answerModelId = answerModelLabel();

/** One answer to a case and how it scored: the lane's first, or a re-ask. */
interface Answered {
  /** The standalone question the pipeline ran (#132) — the case's own, unless
   * it carries `history`. */
  query: string;
  /** Retrieval was weak and the route's fixed decline stood in (no model call). */
  weak: boolean;
  /** The chunks the prompt numbered, so a transcript row can resolve `[n]`.
   * Empty on a weak-retrieval decline, which makes no model call. */
  chunks: readonly RetrievedChunk[];
  /** After #500's absence gate: a false absence claim fails the answer. */
  verdict: Verdict;
  /**
   * The judges' majority alone, before #500's gate: what the baseline counts
   * (#474). The 68/73 was measured before #500 existed, and seven of its 68
   * judge passes make a claim today's detector calls false, so counting the
   * gated verdict would read that same lane as 61. A false absence fails
   * its own zero gate instead. `pass` on a weak-retrieval decline.
   */
  judgesVerdict: Verdict;
  /** One entry per judge call: 1 normally, 1 + REJUDGE_COUNT after a fail. */
  verdicts: Verdict[];
  reason: string;
  /**
   * #474's label on a failure the judges made — recorded, never gated.
   * `null` when they passed the answer, one failed only by #500 included.
   */
  label: FailureLabelling | null;
  answer: string;
  /**
   * The runtime citation invariant, run over the eval's own answers (#168).
   * The harness used to bypass it entirely, so an answer citing nothing —
   * which the route would have retried and then refused to ship — could score
   * a groundedness pass here. `null` on a weak-retrieval decline, which the
   * route streams without markers by construction.
   */
  citations: CitationVerdict | null;
  derivedFigures: ResolvedDerivedFigure[];
  /** `null` on a weak-retrieval decline, which makes no model call. */
  generation: TranscriptGeneration | null;
  /** The rerank's readings (#466); `null` when it never called Voyage. */
  rerank: RerankReadingCount | null;
  /**
   * #500's checks; `null` on a weak-retrieval decline. A false absence claim
   * has already failed `verdict` (`withAbsenceGate`).
   */
  checks: AnswerChecks | null;
}

interface CaseResult extends Answered {
  evalCase: EvalCase;
  /** Absent on a case that declares no requiredClaims/requiredSteps. */
  adequacy: (AdequacyOutcome & { literals: string[] }) | null;
  /**
   * #474: the further answers a blocking case is asked when its first fails.
   * Every rate and count in the lane reads the first answer, as the baseline
   * was measured; only the blocking and absence gates read these, and the
   * blocking gate fails one the route would refuse (`scoreAnswer`).
   */
  reasks: Answered[];
}

/** One answer's groundedness reading, as the transcript records it. */
function groundednessOf(answered: Answered): TranscriptGroundedness {
  return {
    verdict: answered.verdict,
    verdicts: answered.verdicts,
    reason: answered.reason,
    label: answered.label,
  };
}

/** A case and every answer it was asked, first to last. */
function blockingCase(result: CaseResult): BlockingCase {
  return {
    evalCase: result.evalCase,
    answers: [result, ...result.reasks].map(scoreAnswer),
  };
}

/**
 * Every answer the lane scored, the re-asks included, each under the id a
 * console line names it by: `<case>` or `<case> (re-ask n)`.
 */
function everyAnswer(
  results: readonly CaseResult[],
): { id: string; answered: Answered }[] {
  return results.flatMap((r) => [
    { id: r.evalCase.id, answered: r },
    ...r.reasks.map((reask, i) => ({
      id: `${r.evalCase.id} (re-ask ${i + 1})`,
      answered: reask,
    })),
  ]);
}

/**
 * The production answer path on one case, then the judges: the route's
 * pipeline, asked once. The lane calls it for every case, and again for
 * #474's re-asks.
 */
async function answerCase(
  evalCase: EvalCase,
  embedder: Embedder,
  rewrites: Map<string, CaseRewrites> | null,
): Promise<Answered> {
  // #132: a case carrying `history` is a follow-up, and the whole pipeline
  // below — retrieval, rerank, the answer prompt and the judge — sees the
  // condensed standalone question, exactly as /api/ask does. A case without
  // history makes no condensation call at all.
  const { query, expander } = await rewriteCase(evalCase, rewrites);
  const retrieval = await retrieve(query, {
    matchCount: RERANK_POOL,
    embedder,
    expander,
  });

  // The production route streams the deterministic honest fallback on weak
  // retrieval without a model call — no claims, grounded by construction.
  // (The hit-rate eval separately asserts no legitimate question is weak.)
  if (retrieval.isWeak) {
    return {
      query,
      weak: true,
      chunks: [],
      verdict: "pass",
      judgesVerdict: "pass",
      verdicts: [],
      reason: "weak-retrieval fallback (no model call)",
      label: null,
      answer: WEAK_RETRIEVAL_ANSWER,
      citations: null,
      derivedFigures: [],
      generation: null,
      rerank: null,
      checks: null,
    };
  }

  let rerank: RerankReadingCount | null = null;
  const chunks = await pinAnswerSet(
    await rerankChunks(query, retrieval.chunks, {
      ...rerankOptionsFor(retrieval),
      onReadings: (count) => {
        rerank = count;
      },
    }),
    retrieval.chunks,
    query,
  );
  const derivedFigures = resolveDerivedFigures(chunks);
  // The route's date (#455), recorded with the answer below.
  const today = crDate();
  const {
    text: answer,
    finishReason,
    usage,
  } = await generateText({
    model: getAnswerModel(),
    providerOptions: answerProviderOptions(),
    maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
    system: ANSWER_SYSTEM,
    prompt: buildUserPrompt(query, chunks, { today, derivedFigures }),
  });

  // Judged against the same question the answer was written for: asking "is
  // this supported?" about a bare "¿Y si también soy asalariado?" would judge
  // the condensation, not the groundedness.
  const judged = await judgeAnswer(
    query,
    chunks,
    answer,
    undefined,
    derivedFigures,
  );
  // #474: the label reads the judges' failure, before #500's gate can turn a
  // pass into a fail the judges never made.
  const label =
    judged.verdict === "fail"
      ? await labelFailure(query, chunks, answer, judged.reason, derivedFigures)
      : null;
  // #500: a false absence claim is a hard zero, whatever the judge says — it
  // reads the same fragments the model did, so it cannot see one. #547's
  // count hedge is one too; `query` carries the reader's counts #546 reads.
  const checks = checkAnswer(answer, chunks, query);
  return {
    query,
    weak: false,
    chunks,
    ...withAbsenceGate(judged, checks),
    judgesVerdict: judged.verdict,
    label,
    answer,
    derivedFigures,
    generation: {
      finishReason: generationFinishReason(finishReason),
      outputTokens: usage.outputTokens ?? null,
      today,
    },
    rerank,
    checks,
    citations: validateCitations(answer, chunks.length),
  };
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

/**
 * The lane's results as #500's helpers read them: every scored answer, the
 * re-asks included, since a false absence claim fails its case on whichever
 * answer makes it (#474).
 */
function checkedCases(results: readonly CaseResult[]): CheckedCase[] {
  return everyAnswer(results).map(({ id, answered }) => ({
    id,
    checks: answered.checks,
  }));
}

/** A failure's #474 label, for the console. */
function labelTag(answered: Answered): string {
  if (answered.label === null) return "";
  return ` {${answered.label.label ?? "unlabelled"}}`;
}

describeEval("groundedness (eval/dataset.jsonl)", () => {
  // Abstention cases have no correct source and must not be answered at all;
  // they are judged in their own lane (`abstention.eval.test.ts`), not by a
  // judge asking whether their answer was supported.
  const allCases = retrievalCases(DATASET);
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

  /** What the gates read, and the robustness block (#502). */
  const split = () => splitRobustness(results, (r) => r.evalCase);

  beforeAll(async () => {
    // Before any paid call: an id that names no case is a typo that would
    // otherwise buy an empty table.
    const cases = selectCases(allCases, subset, DATASET);
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
    // #457: unset, every case is rewritten live, as the route does it.
    const rewrites = rewritesFromEnv();
    async function askEveryCase(): Promise<void> {
      for (const evalCase of cases) {
        const answered = await answerCase(evalCase, embedder, rewrites);
        const declaresRequirements =
          evalCase.requiredClaims !== undefined ||
          evalCase.requiredSteps !== undefined;
        results.push({
          ...answered,
          evalCase,
          // A decline is never *adequate* on a case that declares required
          // claims: the satisfiability census says the corpus can answer it,
          // so declining is a product failure groundedness cannot see (#261
          // req. 2).
          adequacy: answered.weak
            ? requirementsOf(evalCase)
            : declaresRequirements
              ? {
                  ...(await judgeAdequacy(
                    answered.query,
                    judgedRequirements(evalCase),
                    answered.answer,
                  )),
                  literals: literalFailures(
                    checkLiterals(
                      answered.answer,
                      evalCase.requiredClaims ?? [],
                    ),
                  ),
                }
              : null,
          reasks: [],
        });
      }
    }

    // #474: a blocking case whose first answer failed is asked again,
    // BLOCKING_REASK_COUNT times, through the whole pipeline — the variance
    // is in the answer, not the judge. Only the gated cases: the blocking
    // gate reads nothing else.
    async function reaskFailingBlockingCases(): Promise<void> {
      for (const result of split().gated) {
        if (!needsReask(blockingCase(result))) continue;
        for (let i = 0; i < BLOCKING_REASK_COUNT; i++) {
          result.reasks.push(
            await answerCase(result.evalCase, embedder, rewrites),
          );
        }
      }
    }

    // #289 req. 1: the run leaves its answers behind. The printed table says
    // *which* requirements were missing and can never say why — the answer and
    // the numbered chunk list are what separate «the answer omitted it» from
    // «the fragment was not in the top-8» from «the requirement over-specifies
    // what the corpus carries». Reporting only: nothing below reads the file,
    // and a write failure must not turn a measured run into a red one.
    function recordTranscript(): void {
      try {
        const transcript = writeTranscript(
          results.map((r) =>
            transcriptRow({
              evalCase: r.evalCase,
              query: r.query,
              answer: r.answer,
              chunks: r.chunks,
              derivedFigures: r.derivedFigures,
              groundedness: groundednessOf(r),
              citations: r.citations,
              adequacy:
                r.adequacy === null
                  ? null
                  : {
                      verdict: r.adequacy.verdict,
                      missing: r.adequacy.missing,
                      literals: r.adequacy.literals,
                    },
              generation: r.generation,
              rerank: r.rerank,
              checks: r.checks,
              reasks: r.reasks.map((reask) => ({
                ...reask,
                groundedness: groundednessOf(reask),
              })),
            }),
          ),
          { answerModel: answerModelId, subset: subset !== null },
        );
        console.log(`\ntranscript (#289): ${transcript}`);
      } catch (error) {
        console.log(`\ntranscript (#289): not written — ${String(error)}`);
      }
    }

    // A phase that throws — a provider 5xx, a judge's malformed reply — stops
    // the run, but only after the transcript has written every row paid for
    // before it (#474).
    await runThenRecord(
      [askEveryCase, reaskFailingBlockingCases],
      recordTranscript,
    );
    // #466: a lost reading moves the answer set and nothing else, so the run
    // says how many it lost before any number below is read.
    console.log(
      droppedReadingsSummary(
        everyAnswer(results).map(({ id, answered }) => ({
          id,
          rerank: answered.rerank,
        })),
      ),
    );

    const { gated, block } = split();
    // The judges' count, as the baseline was measured (`judgesVerdict`).
    const passes = gated.filter((r) => r.judgesVerdict === "pass").length;
    console.log(
      `\ngroundedness (answer=${answerModelId}, judge=${JUDGE_MODEL}): ` +
        `${passes}/${gated.length} by the judges (baseline ${GROUNDEDNESS_BASELINE}, ` +
        `floor ${GROUNDEDNESS_FLOOR}; ADR 0023)` +
        (passes > GROUNDEDNESS_BASELINE && subset === null
          ? ` — beats the baseline: ratchet GROUNDEDNESS_BASELINE to ${passes}`
          : ""),
    );
    for (const r of results) {
      const votes = r.verdicts.length > 1 ? ` [${r.verdicts.join("/")}]` : "";
      console.log(
        `  ${r.verdict === "pass" ? "pass" : "FAIL"}${votes}  ${r.evalCase.id}` +
          (r.verdict === "fail" ? `${labelTag(r)}  — ${r.reason}` : ""),
      );
      for (const [i, reask] of r.reasks.entries()) {
        console.log(
          `      re-ask ${i + 1}: ${reask.verdict === "pass" ? "pass" : "FAIL"}` +
            (reask.verdict === "fail"
              ? `${labelTag(reask)}  — ${reask.reason}`
              : ""),
        );
      }
    }

    // #474's two readings beside the headline: the blocking cases settled on
    // three answers, and the labels on every failure the judges made.
    const reasked = gated.filter((r) => r.reasks.length > 0);
    console.log(
      `\nblocking cases re-asked (#474, fail on 2 of 3): ${reasked.length}` +
        (reasked.length > 0
          ? ` — ${reasked
              .map(
                (r) =>
                  `${r.evalCase.id} ${blockingCaseVerdict(blockingCase(r).answers)}`,
              )
              .join(", ")}`
          : ""),
    );
    const labelled = everyAnswer(results)
      .map(({ answered }) => answered)
      .filter((a) => a.label !== null);
    const tally = (label: FailureLabel | null) =>
      labelled.filter((a) => a.label?.label === label).length;
    console.log(
      `failure labels (#474, recorded, not gated): ` +
        `contradiction ${tally("contradiction")}, inference ${tally("inference")}` +
        (tally(null) > 0 ? `, unlabelled ${tally(null)}` : ""),
    );

    console.log(
      formatRobustnessLine(
        "groundedness",
        block,
        (r) => r.evalCase,
        (r) => r.verdict === "pass",
        (r) => `— ${r.reason}`,
      ),
    );

    console.log(
      formatExposureTally(
        "groundedness",
        tallyByExposure(
          gated,
          (r) => r.evalCase,
          (r) => r.verdict === "pass",
        ),
      ),
    );

    const judgedForAdequacy = gated.filter((r) => r.adequacy !== null);
    console.log(
      `\nadequacy (#130): ` +
        `${judgedForAdequacy.filter((r) => !adequacyFailed(r)).length}/` +
        `${judgedForAdequacy.length}`,
    );
    for (const r of results.filter((r) => r.adequacy !== null)) {
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
    // The block's requirements are its seeds' (#502), so this is the same
    // count asked in other words.
    const blockJudged = block.filter((r) => r.adequacy !== null);
    const blockCoverage = requirementCoverage(blockJudged);
    console.log(
      `${formatRobustnessLine(
        "adequacy",
        blockJudged,
        (r) => r.evalCase,
        (r) => !adequacyFailed(r),
        (r) => `— missing: ${adequacyReason(r)}`,
      )}\n  requirements stated: ${blockCoverage.stated}/${blockCoverage.total}`,
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

    console.log(`\n${formatAnswerChecks(checkedCases(results))}`);

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
  // see TIER1_REQUIREMENT_FLOOR. Since ADR 0023 it is a regression alarm
  // against a tracked baseline, not a target. The per-case read (27/27 is
  // the goal) is printed above and named in the failure message.
  it(`states at least ${TIER1_REQUIREMENT_FLOOR} tier 1 requirements (baseline ${TIER1_REQUIREMENT_BASELINE} − ${TIER1_REGRESSION_MARGIN}, ADR 0023)`, () => {
    assertFullRun();
    const tier1 = split().gated.filter((r) => r.evalCase.tier === 1);
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
    const tier2 = split().gated.filter(
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
    const failed = split()
      .gated.filter((r) => r.citations !== null && !r.citations.ok)
      .map(
        (r) =>
          `${r.evalCase.id} (${(r.citations as Exclude<CitationVerdict, { ok: true }>).violation})`,
      );
    expect(failed, `citation violations: ${failed.join("; ")}`).toEqual([]);
  });

  it("claims nothing absent that the corpus carries, in any answer (#500, #474)", () => {
    assertFullRun();
    const claims = falseAbsenceFailures(checkedCases(results));
    expect(claims, `false absence claims: ${claims.join("; ")}`).toEqual([]);
  });

  it(`no blocking case fails on 2 of its ${1 + BLOCKING_REASK_COUNT} answers (#474)`, () => {
    assertFullRun();
    // SPEC §9: «no individually blocking Tier 1 case may fail». Until #324
    // this lane asserted only the rate below, and the 2026-09-11 closing run
    // passed it with two Tier 1 held-out cases failing unanimously. Since
    // #474 a case is read on three answers when its first fails, and a false
    // absence claim on any of them fails it.
    const failed = blockingGroundednessFailures(
      split().gated.map(blockingCase),
    );
    expect(failed, `ungrounded blocking answers: ${failed.join("; ")}`).toEqual(
      [],
    );
  });

  it(`grounds at least ${GROUNDEDNESS_FLOOR} of ${GROUNDEDNESS_CASES} answers (baseline ${GROUNDEDNESS_BASELINE} − ${GROUNDEDNESS_REGRESSION_MARGIN}, ADR 0023)`, () => {
    assertFullRun();
    const { gated } = split();
    // A count means nothing over another population: the dataset grew or
    // shrank, and the baseline is re-set in that change (#474).
    expect(
      gated.length,
      `the baseline counts ${GROUNDEDNESS_CASES} cases; re-set it for ${gated.length}`,
    ).toBe(GROUNDEDNESS_CASES);
    // The judges' verdict on the first answer, as the baseline was measured:
    // one answer a case, before #500's gate (`judgesVerdict`).
    const failed = gated
      .filter((r) => r.judgesVerdict === "fail")
      .map((r) => `${r.evalCase.id} (${r.reason})`);
    expect(
      gated.length - failed.length,
      `ungrounded answers: ${failed.join("; ")}`,
    ).toBeGreaterThanOrEqual(GROUNDEDNESS_FLOOR);
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
    const failed = split()
      .gated.filter((r) => r.derivedFigures.length > 0)
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
