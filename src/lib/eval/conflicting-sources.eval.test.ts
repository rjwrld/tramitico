/**
 * Adversarial conflicting-sources eval (issue #135, decision on #121): the one
 * case the dataset cannot hold, because the corpus does not contradict itself.
 *
 * It runs the production answer path from the prompt down — ANSWER_MODEL with
 * ANSWER_SYSTEM_PROMPT and buildUserPrompt — over two hand-written fragments
 * that disagree on one figure, then asks the conflict judge whether the answer
 * told the reader they disagree, gave both figures, and cited both. It is a
 * blocking single case: pass or fail, no rate.
 *
 * It needs no database and no embeddings — the fragments stand in for
 * retrieval — so it is gated on ANTHROPIC_API_KEY alone and runs at the judge
 * cadence, in the same lane as the groundedness gate:
 *
 *   ANTHROPIC_API_KEY=<key> \
 *   pnpm vitest run src/lib/eval/conflicting-sources.eval.test.ts
 */
import { generateText } from "ai";
import { beforeAll, expect, it } from "vitest";
import { DEFAULT_ANSWER_MODEL, getAnswerModel } from "../answer/model";
import { ANSWER_SYSTEM_PROMPT, buildUserPrompt } from "../answer/prompt";
import {
  conflictJudgeOnce,
  CONFLICT_CHUNKS,
  CONFLICT_FIGURES,
  CONFLICT_QUESTION,
} from "./conflicting-sources";
import { judgeAnswer, JUDGE_MODEL, type Verdict } from "./groundedness";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";

// `describe.runIf` was a silent skip: with no key this suite reported zero
// tests and the eval lane went green having asserted nothing — the exact
// failure mode #129 exists to prevent. The shared gate skips locally and
// *fails*, naming ANTHROPIC_API_KEY, under CI.
const describeEval = integrationSuite(envPrereqs("ANTHROPIC_API_KEY"));
const answerModelId = process.env.ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL;

describeEval("conflicting sources (#135)", () => {
  let answer = "";
  let verdict: Verdict = "fail";
  let verdicts: Verdict[] = [];
  let reason = "";

  beforeAll(async () => {
    const generated = await generateText({
      model: getAnswerModel(),
      system: ANSWER_SYSTEM_PROMPT,
      prompt: buildUserPrompt(CONFLICT_QUESTION, CONFLICT_CHUNKS),
    });
    answer = generated.text;
    ({ verdict, verdicts, reason } = await judgeAnswer(
      CONFLICT_QUESTION,
      CONFLICT_CHUNKS,
      answer,
      conflictJudgeOnce,
    ));
    const votes = verdicts.length > 1 ? ` [${verdicts.join("/")}]` : "";
    console.log(
      `\nconflicting sources (answer=${answerModelId}, judge=${JUDGE_MODEL}): ` +
        `${verdict}${votes}\n${answer}\n`,
    );
  }, 300_000);

  it("states the discrepancy and cites both sources", () => {
    expect(verdict, `judge: ${reason}\n\nanswer:\n${answer}`).toBe("pass");
  });

  it("carries both contradicting figures and both citation markers", () => {
    // A cheap, judge-independent floor under the same property: whatever the
    // judge thinks, an answer that dropped one figure or one marker did pick
    // a side.
    for (const figure of CONFLICT_FIGURES) {
      expect(answer, `answer:\n${answer}`).toContain(figure);
    }
    expect(answer).toContain("[1]");
    expect(answer).toContain("[2]");
  });
});
