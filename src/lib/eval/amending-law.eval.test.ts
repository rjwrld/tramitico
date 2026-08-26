/**
 * Consolidated-vs-amending eval (issue #182): the other half of the rule 4
 * contract, and the one `conflicting-sources.eval.test.ts` cannot hold.
 *
 * That suite proves the model reports a genuine conflict. This one proves it
 * does not invent one where the corpus only holds a consolidated law beside
 * the law that reformed it — the structural false positive that cost the
 * groundedness gate its `iva-tarifas-reducidas` case. Run the two together:
 * a rule 4 change that fixes one by breaking the other is the failure mode
 * #182 exists to prevent.
 *
 * A/B run 2026-08-25, answer=claude-sonnet-5, judge=claude-sonnet-4-5, same
 * fixture and same judge on both arms: the rule 4 of HEAD~1 **fails** it 3/3
 * (unanimous), the rule 4 of this branch passes. The old arm reproduced the
 * production defect verbatim — «En cuanto a los servicios de educación
 * privada, las fuentes discrepan», followed by a referral to Hacienda to
 * check which wording rules — over a difference that is only the 2024 reform
 * fragment [1] itself annotates. That is the evidence this suite is not
 * vacuous: it separates the two prompts, rather than passing either way.
 *
 * Like the conflict case it needs no database and no embeddings — the
 * fragments stand in for retrieval — so it is gated on ANTHROPIC_API_KEY alone
 * and runs in the eval lane:
 *
 *   ANTHROPIC_API_KEY=<key> \
 *   pnpm vitest run src/lib/eval/amending-law.eval.test.ts
 */
import { generateText } from "ai";
import { beforeAll, expect, it } from "vitest";
import { DEFAULT_ANSWER_MODEL, getAnswerModel } from "../answer/model";
import { ANSWER_SYSTEM_PROMPT, buildUserPrompt } from "../answer/prompt";
import {
  amendingJudgeOnce,
  AMENDING_CHUNKS,
  AMENDING_ONLY_IN_CONSOLIDATED,
  AMENDING_QUESTION,
} from "./amending-law";
import { judgeAnswer, JUDGE_MODEL, type Verdict } from "./groundedness";
import { envPrereqs, integrationSuite } from "../test-support/suite-gate";

const describeEval = integrationSuite(envPrereqs("ANTHROPIC_API_KEY"));
const answerModelId = process.env.ANSWER_MODEL ?? DEFAULT_ANSWER_MODEL;

describeEval("consolidated law beside its reform (#182)", () => {
  let answer = "";
  let verdict: Verdict = "fail";
  let verdicts: Verdict[] = [];
  let reason = "";

  beforeAll(async () => {
    const generated = await generateText({
      model: getAnswerModel(),
      system: ANSWER_SYSTEM_PROMPT,
      prompt: buildUserPrompt(AMENDING_QUESTION, AMENDING_CHUNKS),
    });
    answer = generated.text;
    ({ verdict, verdicts, reason } = await judgeAnswer(
      AMENDING_QUESTION,
      AMENDING_CHUNKS,
      answer,
      amendingJudgeOnce,
    ));
    const votes = verdicts.length > 1 ? ` [${verdicts.join("/")}]` : "";
    console.log(
      `\nconsolidated vs reform (answer=${answerModelId}, judge=${JUDGE_MODEL}): ` +
        `${verdict}${votes}\n${answer}\n`,
    );
  }, 300_000);

  it("does not report the two moments of one norma as a live discrepancy", () => {
    expect(verdict, `judge: ${reason}\n\nanswer:\n${answer}`).toBe("pass");
  });

  it("answers from the consolidated text, whose rates are the current ones", () => {
    // A judge-independent floor under the same property: the bracket that
    // exists only in the consolidated text is the current law, so an answer
    // about the reduced rates has to carry it.
    expect(answer, `answer:\n${answer}`).toContain(
      AMENDING_ONLY_IN_CONSOLIDATED,
    );
    expect(answer, `answer:\n${answer}`).toContain("[1]");
  });
});
