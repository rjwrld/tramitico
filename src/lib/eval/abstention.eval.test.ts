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
import { condenseQuestion } from "../answer/condense";
import { answerProviderOptions, getAnswerModel } from "../answer/model";
import {
  ANSWER_SYSTEM,
  buildUserPrompt,
  WEAK_RETRIEVAL_ANSWER,
} from "../answer/prompt";
import {
  pinDerivedFigureInputs,
  resolveDerivedFigures,
} from "../answer/derived";
import { rerankChunks, RERANK_POOL } from "../answer/rerank";
import { createEmbedder, realEmbedderConfigured } from "../ingestion/embedder";
import { retrieve } from "../retrieval";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";
import { figureMentions, judgeAbstention } from "./adequacy";
import { abstentionCases, DATASET_PATH, parseDataset } from "./dataset";
import { DEFAULT_TRANSCRIPT_DIR } from "./transcript";
import type { EvalCase } from "./dataset";
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
 * every time it answers these nine questions. Gitignored and worktree-local
 * like the rest: copy it to the main checkout before the worktree goes.
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
          verdict: r.verdict,
          verdicts: r.verdicts,
          reason: r.reason,
          figures: r.figures,
          answer: r.answer,
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
  /** The colón amounts and percentages the answer had no business printing. */
  figures: string[];
  /** What the pipeline actually said — the transcript's reason for existing. */
  answer: string;
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
    for (const evalCase of cases) {
      const { query } = await condenseQuestion(
        evalCase.question,
        evalCase.history ?? [],
      );
      const retrieval = await retrieve(query, {
        matchCount: RERANK_POOL,
        embedder,
      });

      let answer = WEAK_RETRIEVAL_ANSWER;
      // Empty on the fallback route, which had no fragments: `figureMentions`
      // then keeps its strict form and counts every figure (#290).
      let sources: string[] | undefined;
      const viaFallback = retrieval.isWeak;
      if (!viaFallback) {
        // Retrieval found something for a question with no correct source.
        // The decline now has to come from rule 6 of the answer prompt, which
        // is exactly the case worth measuring.
        const chunks = pinDerivedFigureInputs(
          await rerankChunks(query, retrieval.chunks, {
            expansion: retrieval.expansion,
          }),
          retrieval.chunks,
        );
        // `derivedFigures` because the route passes them (#287): a lane that
        // omits them measures a decline written without the one block the
        // reader's answer would have carried.
        const derivedFigures = resolveDerivedFigures(chunks);
        answer = (
          await generateText({
            model: getAnswerModel(),
            providerOptions: answerProviderOptions(),
            system: ANSWER_SYSTEM,
            prompt: buildUserPrompt(query, chunks, { derivedFigures }),
          })
        ).text;
        sources = [
          ...chunks.map((chunk) => chunk.content),
          ...derivedFigures.map((figure) => figure.formattedValue),
        ];
      }

      const judged = await judgeAbstention(query, answer, {
        abstainIf: evalCase.abstainIf as string,
        ...(evalCase.routeTo === undefined
          ? {}
          : { routeTo: evalCase.routeTo }),
      });
      results.push({
        evalCase,
        ...judged,
        viaFallback,
        figures: figureMentions(answer, sources),
        answer,
      });
    }

    const passes = results.filter((r) => r.verdict === "pass").length;
    console.log(`\nabstention: ${passes}/${results.length}`);
    console.log(`  transcript: ${writeAbstentionTranscript(results)}`);
    for (const r of results) {
      const votes = r.verdicts.length > 1 ? ` [${r.verdicts.join("/")}]` : "";
      console.log(
        `  ${r.verdict === "pass" ? "pass" : "FAIL"}${votes}` +
          `  ${r.viaFallback ? "fallback" : "model   "}  ${r.evalCase.id}` +
          (r.verdict === "fail" ? `  — ${r.reason}` : "") +
          (r.figures.length > 0 ? `  figures: ${r.figures.join(", ")}` : ""),
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

  it("invents no figure while declining", () => {
    const invented = results
      .filter((r) => r.figures.length > 0)
      .map((r) => `${r.evalCase.id}: ${r.figures.join(", ")}`);
    expect(invented, `invented figures: ${invented.join("; ")}`).toEqual([]);
  });
});
