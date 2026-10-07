/**
 * The abstention lane (issue #261 req. 5, #254 Part A §A3).
 *
 * The trust contract has a second half that the hit-rate and groundedness
 * gates cannot express: some questions the product must **not** answer —
 * out-of-scope ("¿cuánto cobro por hora?"), false premise, a figure no
 * official source states, or a question that belongs to another institution.
 * Those cases carry no `expected` targets, because no correct source exists,
 * so the other suites skip them (`retrievalCases`) and this one picks them up.
 *
 * It runs the same production path as the groundedness gate — condense,
 * retrieve, rerank, answer — because *how* the pipeline declines is the thing
 * under test: usually `retrieval.isWeak` short-circuits to the deterministic
 * fallback, but a question whose vocabulary happens to retrieve well reaches
 * the model, and then rule 6 of the answer prompt is what must hold. Both
 * routes are judged by the same binary question: did it decline, and did it
 * name where to go?
 *
 * Two assertions, matching §A3: correct abstention ≥ 90%, and **zero** invented
 * figures — a regex, not a judgement. What counts as invented depends on the
 * route the case took, and `figureMentions` is told which (#290): on the
 * fallback there are no fragments, so every figure was made up; on the model
 * route a figure the fragments carry and the answer cites is rule 6 working,
 * and only an uncited or unsourced one is an invention.
 *
 * A third since #502, for a case that declares `requiredClaims`: declining is
 * not the whole of it. `ho-abs-iva-2027` declines a 2027 rate and still owes
 * the reader today's — 13 % and the artículo 10 that sets it, cited, and
 * never the claim that the artículo is missing from the documents (#490 item
 * 2), which the committed answers made and the judge passed. The lane scores
 * and prints it; the assertion waits for #507 and #508.
 *
 * Env-gated exactly like the groundedness gate; it runs in the same lane:
 *
 *   ANTHROPIC_API_KEY=<key> SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… \
 *   EMBEDDINGS_PROVIDER=voyage VOYAGE_API_KEY=<key> \
 *   pnpm vitest run src/lib/eval/abstention.eval.test.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateText } from "ai";
import { beforeAll, expect, it } from "vitest";
import {
  ANSWER_MAX_OUTPUT_TOKENS,
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
  pinDerivedFigureInputs,
  resolveDerivedFigures,
} from "../answer/derived";
import {
  rerankChunks,
  rerankOptionsFor,
  RERANK_POOL,
  type RerankReadingCount,
} from "../answer/rerank";
import { createEmbedder, realEmbedderConfigured } from "../ingestion/embedder";
import { retrieve } from "../retrieval";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import {
  abstentionRequirementFailures,
  figureMentions,
  judgeAbstention,
} from "./adequacy";
import {
  checkAnswer,
  falseAbsenceFailures,
  formatAnswerChecks,
  withAbsenceGate,
  type AnswerChecks,
  type CheckedCase,
} from "./answer-checks";
import { abstentionCases, DATASET_PATH, parseDataset } from "./dataset";
import { rewriteCase, rewritesFromEnv } from "./rewrites";
import {
  DEFAULT_TRANSCRIPT_DIR,
  droppedReadingsSummary,
  type TranscriptGeneration,
} from "./transcript";
import type { EvalCase, Family } from "./dataset";
import type { Verdict } from "./groundedness";

/** §A3: correct abstention ≥ 0.90 on the abstention set. Ratchet up. */
export const ABSTENTION_GATE = 0.9;

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

/**
 * The run's answers, written beside the other lanes' transcripts (#290).
 *
 * The console block says *what* each verdict was; only the answer says why,
 * and a judge verdict or a figure flag is unreadable without it. The other
 * two paid lanes have had transcripts since #261 and this one did not, so its
 * runs left nothing to re-read — a bad trade for a lane that costs real money
 * every time it answers these nine questions. Gitignored like the rest; in a
 * worktree the directory links to the main checkout's (CLAUDE.md, Worktrees).
 */
function writeAbstentionTranscript(results: readonly CaseResult[]): string {
  const dir = process.env.EVAL_TRANSCRIPT_DIR ?? DEFAULT_TRANSCRIPT_DIR;
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `abstention-${stamp}.jsonl`);
  writeFileSync(
    path,
    results
      .map((r) =>
        JSON.stringify({
          id: r.evalCase.id,
          question: r.evalCase.question,
          route: r.viaFallback ? "fallback" : "model",
          stepFamily: r.stepFamily,
          verdict: r.verdict,
          verdicts: r.verdicts,
          reason: r.reason,
          figures: r.figures,
          requirements: r.requirements,
          answer: r.answer,
          generation: r.generation,
          rerank: r.rerank,
          checks: r.checks,
        }),
      )
      .join("\n") + "\n",
    "utf8",
  );
  return path;
}

interface CaseResult {
  evalCase: EvalCase;
  verdict: Verdict;
  verdicts: Verdict[];
  reason: string;
  /** Whether the decline came from the deterministic fallback or the model. */
  viaFallback: boolean;
  /**
   * The Tier 1 family the step probe classified the question into (#465), or
   * `null` when it named none. On the model route the rerank read that
   * family's sentences and could append `pin1`'s pick, as the route's does;
   * the fallback reranks nothing, so there it only says what the probe saw.
   */
  stepFamily: Family | null;
  /** The colón amounts and percentages the answer had no business printing. */
  figures: string[];
  /**
   * What the case's `requiredClaims` found missing (#502); `null` for a case
   * that declares none, which is every case but `ho-abs-iva-2027`.
   */
  requirements: string[] | null;
  /** What the pipeline actually said — the transcript's reason for existing. */
  answer: string;
  /** `null` on the fallback route, which calls no model. */
  generation: TranscriptGeneration | null;
  /** The rerank's readings (#466); `null` when it never called Voyage. */
  rerank: RerankReadingCount | null;
  /**
   * #500's checks; `null` on the fallback route, a fixed text. A false
   * absence claim has already failed `verdict` (`withAbsenceGate`).
   */
  checks: AnswerChecks | null;
}

/** The lane's results as #500's helpers read them. */
function checkedCases(results: readonly CaseResult[]): CheckedCase[] {
  return results.map((r) => ({ id: r.evalCase.id, checks: r.checks }));
}

describeEval("abstention set (eval/dataset.jsonl)", () => {
  const cases = abstentionCases(
    parseDataset(readFileSync(DATASET_PATH, "utf8")),
  );
  const results: CaseResult[] = [];

  beforeAll(async () => {
    // Constructed here, not in the describe body: `describe.skip` still runs
    // its callback (#129/#211).
    const embedder = createEmbedder();
    // #457: unset, every case is rewritten live, as the route does it.
    const rewrites = rewritesFromEnv();
    for (const evalCase of cases) {
      const { query, expander } = await rewriteCase(evalCase, rewrites);
      const retrieval = await retrieve(query, {
        matchCount: RERANK_POOL,
        embedder,
        expander,
      });

      let answer = WEAK_RETRIEVAL_ANSWER;
      let generation: TranscriptGeneration | null = null;
      let rerank: RerankReadingCount | null = null;
      let checks: AnswerChecks | null = null;
      // Empty on the fallback route, which had no fragments: `figureMentions`
      // then keeps its strict form and counts every figure (#290).
      let sources: string[] | undefined;
      const viaFallback = retrieval.isWeak;
      if (!viaFallback) {
        // Retrieval found something for a question with no correct source.
        // The decline now has to come from rule 6 of the answer prompt, which
        // is exactly the case worth measuring. The route's rerank options,
        // step sentences included (#465): without them a case that classifies
        // into a family declines on a chunk set production never builds.
        const chunks = pinDerivedFigureInputs(
          await rerankChunks(query, retrieval.chunks, {
            ...rerankOptionsFor(retrieval),
            onReadings: (count) => {
              rerank = count;
            },
          }),
          retrieval.chunks,
        );
        // `derivedFigures` because the route passes them (#287): a lane that
        // omits them measures a decline written without the one block the
        // reader's answer would have carried.
        const derivedFigures = resolveDerivedFigures(chunks);
        // The route's date (#455): «ya venció» is read against the day asked.
        const today = crDate();
        const generated = await generateText({
          model: getAnswerModel(),
          providerOptions: answerProviderOptions(),
          maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
          system: ANSWER_SYSTEM,
          prompt: buildUserPrompt(query, chunks, { today, derivedFigures }),
        });
        answer = generated.text;
        generation = {
          finishReason: generationFinishReason(generated.finishReason),
          outputTokens: generated.usage.outputTokens ?? null,
          today,
        };
        sources = [
          ...chunks.map((chunk) => chunk.content),
          ...derivedFigures.map((figure) => figure.formattedValue),
        ];
        // #500: a decline that says the corpus lacks what it carries — Ley
        // IVA art. 10 under «¿cuál será el IVA en 2027?» — is a hard zero.
        checks = checkAnswer(answer, chunks);
      }

      const judged = withAbsenceGate(
        await judgeAbstention(query, answer, {
          abstainIf: evalCase.abstainIf as string,
          ...(evalCase.routeTo === undefined
            ? {}
            : { routeTo: evalCase.routeTo }),
        }),
        checks,
      );
      results.push({
        evalCase,
        ...judged,
        viaFallback,
        stepFamily: retrieval.steps?.family ?? null,
        figures: figureMentions(answer, sources),
        requirements:
          evalCase.requiredClaims === undefined
            ? null
            : abstentionRequirementFailures(
                answer,
                evalCase.requiredClaims,
                checks?.absence.falseClaims ?? [],
              ),
        answer,
        generation,
        rerank,
        checks,
      });
    }

    const passes = results.filter((r) => r.verdict === "pass").length;
    console.log(`\nabstention: ${passes}/${results.length}`);
    console.log(`  transcript: ${writeAbstentionTranscript(results)}`);
    console.log(
      `  ${droppedReadingsSummary(
        results.map((r) => ({ id: r.evalCase.id, rerank: r.rerank })),
      )}`,
    );
    console.log(formatAnswerChecks(checkedCases(results)));
    for (const r of results) {
      const votes = r.verdicts.length > 1 ? ` [${r.verdicts.join("/")}]` : "";
      console.log(
        `  ${r.verdict === "pass" ? "pass" : "FAIL"}${votes}` +
          `  ${r.viaFallback ? "fallback" : "model   "}  ${r.evalCase.id}` +
          (r.verdict === "fail" ? `  — ${r.reason}` : "") +
          (r.figures.length > 0 ? `  figures: ${r.figures.join(", ")}` : ""),
      );
    }
    const required = results.filter((r) => r.requirements !== null);
    console.log(
      `abstention requirements (#502): ${required.filter((r) => r.requirements!.length === 0).length}/${required.length}`,
    );
    for (const r of required) {
      console.log(
        `  ${r.requirements!.length === 0 ? "pass" : "FAIL"}  ${r.evalCase.id}` +
          r.requirements!.map((failure) => `\n        ${failure}`).join(""),
      );
    }
    // Serial on purpose, like the other suites: shared Voyage keyless budget.
  }, 2_700_000);

  it(`declines and routes on at least ${ABSTENTION_GATE * 100}% of the abstention set`, () => {
    const failed = results
      .filter((r) => r.verdict === "fail")
      .map((r) => `${r.evalCase.id} (${r.reason})`);
    // An empty abstention set is a dataset problem, not a passing gate.
    expect(results.length, "the abstention set is empty").toBeGreaterThan(0);
    const rate = (results.length - failed.length) / results.length;
    expect(
      rate,
      `answered instead of declining: ${failed.join("; ")}`,
    ).toBeGreaterThanOrEqual(ABSTENTION_GATE);
  });

  it("claims nothing absent that the corpus carries (#500)", () => {
    const claims = falseAbsenceFailures(checkedCases(results));
    expect(claims, `false absence claims: ${claims.join("; ")}`).toEqual([]);
  });
  // #502: scored and printed above on every lane, not yet asserted. 17 of the
  // 19 committed answers fail it, the fixes are #507 (the prompt) and #508
  // (art. 30 → art. 10), and a gate that starts red decides nothing (#497).
  // The absence half is gated sooner, by #500's detector.
  it.todo(
    "gives what an abstention case requires, and denies no artículo (#502) — armed when #507 and #508 land",
  );

  it("invents no figure while declining", () => {
    const invented = results
      .filter((r) => r.figures.length > 0)
      .map((r) => `${r.evalCase.id}: ${r.figures.join(", ")}`);
    expect(invented, `invented figures: ${invented.join("; ")}`).toEqual([]);
  });
});
