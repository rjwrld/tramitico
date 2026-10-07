/**
 * Answer replay (#451): re-answer a committed groundedness transcript's rows
 * from their own chunk lists, with today's prompt and `ANSWER_MODEL` /
 * `ANSWER_EFFORT`, and score the new answers with the lane's judges. Retrieval
 * is held fixed, so a prompt change is read against the recorded answers
 * without the chunk-list noise of a full lane (see `src/lib/eval/replay.ts`).
 *
 *   ANSWER_MODEL=claude-sonnet-5-5 ANSWER_EFFORT=low \
 *     pnpm answer-replay <transcript.jsonl> [--tier=1] [--cases=a,b]
 *     [--no-groundedness] [--dry-run]
 *
 * Per row: one answer call (production's system message, output cap and
 * provider options), the adequacy judge, and — unless `--no-groundedness` —
 * the groundedness judge. Paid: about US$0.10 a row with both judges, about
 * half that without the groundedness one. The corpus database is read only
 * for document titles, and a row whose chunks it no longer carries stops the
 * replay before it starts.
 *
 * Writes a transcript (`groundedness-<model>-replay-…jsonl`, flagged `subset`)
 * to `EVAL_TRANSCRIPT_DIR`, default `eval/transcripts/` — gitignored, and in a
 * worktree a link to the main checkout's (CLAUDE.md, Worktrees). A diagnostic, not
 * a gate. `--dry-run` stops after rebuilding every prompt: free, and it says
 * whether the transcript still matches the corpus. Reads `.env.local` like
 * `ingest.ts`.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { generateText } from "ai";
import {
  incompletelyCitedDerivedFigures,
  resolveDerivedFigures,
} from "../src/lib/answer/derived";
import { validateCitations } from "../src/lib/answer/invariant";
import { checkAnswer } from "../src/lib/eval/answer-checks";
import {
  ANSWER_MAX_OUTPUT_TOKENS,
  answerModelLabel,
  answerProviderOptions,
  getAnswerModel,
} from "../src/lib/answer/model";
import { ANSWER_SYSTEM, buildUserPrompt } from "../src/lib/answer/prompt";
import { crDate } from "../src/lib/cr-time";
import {
  checkLiterals,
  judgeAdequacy,
  judgedRequirements,
  literalFailures,
} from "../src/lib/eval/adequacy";
import { DATASET_PATH, parseDataset, type Tier } from "../src/lib/eval/dataset";
import { judgeAnswer } from "../src/lib/eval/groundedness";
import {
  coverageDelta,
  parseTranscript,
  replayChunks,
  replayPlan,
  type CoverageItem,
} from "../src/lib/eval/replay";
import {
  transcriptRow,
  writeTranscript,
  type TranscriptRow,
} from "../src/lib/eval/transcript";
import { generationFinishReason } from "../src/lib/telemetry";
import { chunkDocMeta } from "./chunk-doc-meta";

/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

function flag(name: string): string | null {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit === undefined ? null : hit.slice(name.length + 3);
}

function tierFlag(): Tier | null {
  const raw = flag("tier");
  if (raw === null) return null;
  if (raw === "1") return 1;
  if (raw === "2") return 2;
  throw new Error(`--tier takes 1 or 2, got ${raw}`);
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (file === undefined) {
    throw new Error(
      "usage: pnpm answer-replay <transcript.jsonl> [--tier=1|2] " +
        "[--cases=a,b] [--no-groundedness] [--dry-run]",
    );
  }
  const judgeGroundedness = !process.argv.includes("--no-groundedness");
  const cases =
    flag("cases")
      ?.split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "") ?? null;

  const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const plan = replayPlan(
    parseTranscript(readFileSync(file, "utf8")),
    dataset,
    {
      cases,
      tier: tierFlag(),
    },
  );
  // Every row's prompt is rebuilt before the first paid call, so a transcript
  // the corpus has drifted from costs nothing.
  const meta = await chunkDocMeta();
  const prompts = plan.map((item) => ({
    ...item,
    chunks: replayChunks(item.row, meta),
  }));

  if (process.argv.includes("--dry-run")) {
    console.log(`dry run: ${prompts.length} prompt(s) rebuilt, no model call`);
    return;
  }

  const label = answerModelLabel();
  console.log(
    `replaying ${prompts.length} row(s) of ${path.basename(file)} on ${label}` +
      (judgeGroundedness ? "" : " (no groundedness judge)"),
  );

  const replayed: TranscriptRow[] = [];
  const deltaInput: CoverageItem[] = [];
  const uncited: string[] = [];
  for (const { row, evalCase, chunks } of prompts) {
    const derivedFigures = resolveDerivedFigures(chunks);
    // Today's CR date, as the route would pass it (#455) — not the date the
    // replayed transcript was answered on: a replay reads today's prompt.
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
      prompt: buildUserPrompt(row.query, chunks, { today, derivedFigures }),
    });
    const groundedness = judgeGroundedness
      ? await judgeAnswer(row.query, chunks, answer, undefined, derivedFigures)
      : { verdict: "pass" as const, verdicts: [], reason: "not judged" };
    const declares =
      evalCase.requiredClaims !== undefined ||
      evalCase.requiredSteps !== undefined;
    const judged = declares
      ? await judgeAdequacy(row.query, judgedRequirements(evalCase), answer)
      : null;
    const adequacy =
      judged === null
        ? null
        : {
            verdict: judged.verdict,
            missing: judged.missing,
            literals: literalFailures(
              checkLiterals(answer, evalCase.requiredClaims ?? []),
            ),
          };
    replayed.push(
      transcriptRow({
        evalCase,
        query: row.query,
        answer,
        chunks,
        derivedFigures,
        groundedness,
        citations: validateCitations(answer, chunks.length),
        adequacy,
        generation: {
          finishReason: generationFinishReason(finishReason),
          outputTokens: usage.outputTokens ?? null,
          today,
        },
        // The replay answers on the source row's chunks, so the readings
        // that chose them are the source's (#466); absent before #466.
        rerank: row.rerank ?? null,
        checks: checkAnswer(answer, chunks),
      }),
    );
    const incomplete = incompletelyCitedDerivedFigures(answer, derivedFigures);
    if (incomplete.length > 0)
      uncited.push(`${row.id} (${incomplete.join(", ")})`);
    if (row.adequacy !== null && adequacy !== null) {
      deltaInput.push({ evalCase, before: row.adequacy, after: adequacy });
    }
    console.log(
      `  ${row.id}  ${groundedness.verdict}` +
        (adequacy === null
          ? ""
          : `  missing ${adequacy.missing.length + adequacy.literals.length}`),
    );
  }

  // Before the summary: the rows are what cost money, and a summary that
  // throws must not take them with it.
  // A row the groundedness judge never read still needs a verdict in the
  // transcript's shape, so the file name says none of them were judged.
  const written = writeTranscript(replayed, {
    answerModel: `${label}-replay${judgeGroundedness ? "" : "-ungrounded"}`,
    subset: true,
  });
  console.log(`\ntranscript: ${written}`);

  const delta = coverageDelta(deltaInput);
  console.log(
    `\nrequirements stated, recorded → replayed: ` +
      `${delta.before.stated} → ${delta.after.stated} of ${delta.after.total}`,
  );
  for (const c of delta.cases) {
    if (c.before !== c.after || c.after < c.total) {
      console.log(`  ${c.before} → ${c.after} / ${c.total}  ${c.id}`);
    }
  }
  if (judgeGroundedness) {
    const grounded = replayed.filter((r) => r.groundedness.verdict === "pass");
    const recorded = plan.filter((p) => p.row.groundedness.verdict === "pass");
    console.log(
      `grounded, recorded → replayed: ${recorded.length} → ${grounded.length} of ${replayed.length}`,
    );
  }
  // #500, and #507's measurement: the recorded side is re-checked here, free,
  // since rows written before #500 carry no `checks`.
  const recordedClaims = plan.flatMap(({ row }) =>
    checkAnswer(row.answer, row.chunks).absence.falseClaims.map(() => row.id),
  );
  const replayedClaims = replayed.flatMap((r) =>
    (r.checks?.absence.falseClaims ?? []).map(() => r.id),
  );
  console.log(
    `false absence claims (#500), recorded → replayed: ` +
      `${recordedClaims.length} → ${replayedClaims.length}` +
      (replayedClaims.length > 0 ? ` — ${replayedClaims.join(", ")}` : ""),
  );
  const refused = replayed.filter((r) => r.citations && !r.citations.ok);
  const cut = replayed.filter((r) => r.generation?.finishReason !== "stop");
  const tokens = replayed.map((r) => r.generation?.outputTokens ?? 0);
  console.log(
    `citation invariant: ${refused.length} violation(s)` +
      (refused.length > 0 ? ` — ${refused.map((r) => r.id).join(", ")}` : ""),
  );
  console.log(
    `derived figures incompletely cited: ${uncited.length}` +
      (uncited.length > 0 ? ` — ${uncited.join("; ")}` : ""),
  );
  console.log(
    `finish other than stop: ${cut.length}; output tokens max ${Math.max(...tokens)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
