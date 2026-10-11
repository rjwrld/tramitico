// Free: an upper-side cost estimate for a replay transcript. The transcript
// records only the answer call's output tokens, so every input is estimated
// from characters at 3 chars a token (conservative for Spanish legal text),
// with no prompt-cache discount, judge outputs assumed. Sonnet 5.5 at US$2/10
// per MTok, the judges (claude-sonnet-4-5) at US$3/15.
//
//   pnpm exec tsx eval/runs/2026-10-10-591/cost.ts <replay transcript.jsonl>
import { readFileSync } from "node:fs";
import { ANSWER_SYSTEM_PROMPT } from "../../../src/lib/answer/prompt";
import { JUDGE_SYSTEM_PROMPT } from "../../../src/lib/eval/groundedness";
const file = process.argv[2];
const rows = readFileSync(file, "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));
const CHARS_PER_TOKEN = 3.0; // conservative for Spanish legal text
let total = 0;
for (const r of rows) {
  const chunkChars = r.chunks.reduce(
    (n: number, c: { content: string }) => n + c.content.length + 80,
    0,
  );
  const answerIn =
    (ANSWER_SYSTEM_PROMPT.length + chunkChars + r.query.length + 400) /
    CHARS_PER_TOKEN;
  const answerOut = r.generation.outputTokens;
  // Groundedness judge: its system prompt, the fragments, the answer; 600 output tokens assumed.
  const judgeIn =
    (chunkChars +
      r.answer.length +
      r.query.length +
      JUDGE_SYSTEM_PROMPT.length) /
    CHARS_PER_TOKEN;
  const judgeOut = 600;
  // Adequacy judge on cases with requirements: requirements + answer, 300 out.
  const adeqIn = r.adequacy ? (r.answer.length + 3000) / CHARS_PER_TOKEN : 0;
  const adeqOut = r.adequacy ? 300 : 0;
  const usd =
    (answerIn * 2 + answerOut * 10) / 1e6 +
    ((judgeIn + adeqIn) * 3 + (judgeOut + adeqOut) * 15) / 1e6;
  total += usd;
  console.log(
    `${r.id.padEnd(24)} answer in≈${Math.round(answerIn)} out=${answerOut} | judge in≈${Math.round(judgeIn + adeqIn)} | ≈US$${usd.toFixed(3)}`,
  );
}
console.log(
  `total ≈US$${total.toFixed(3)}, ≈US$${(total / rows.length).toFixed(3)}/row`,
);
