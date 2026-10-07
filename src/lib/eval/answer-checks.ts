/**
 * #500's two deterministic checks on one answer, run the same way by the
 * groundedness and abstention lanes, `answer-replay` and the route: a false
 * corpus-absence claim (`absence.ts`) and a typo run (`typo.ts`).
 *
 * What each caller does with them differs, and is decided here once for the
 * lanes: a false absence claim is a hard zero for its case, and a typo run is
 * reported, never gated. The route only counts both (`telemetry.ts`).
 */
import {
  citedChunks,
  COMMITTED_COVERAGE,
  describeFalseAbsence,
  detectAbsenceClaims,
  type AbsenceReport,
  type CitedChunk,
  type CorpusCoverage,
} from "./absence";
import type { Verdict } from "./groundedness";
import { typoRuns } from "./typo";

export interface AnswerChecks {
  absence: AbsenceReport;
  typos: string[];
}

/** `chunks` is the numbered list the prompt showed; the answer's markers pick from it. */
export function checkAnswer(
  answer: string,
  chunks: readonly CitedChunk[],
  coverage: CorpusCoverage = COMMITTED_COVERAGE,
): AnswerChecks {
  return {
    absence: detectAbsenceClaims(answer, {
      cited: citedChunks(answer, chunks),
      coverage,
    }),
    typos: typoRuns(answer),
  };
}

/**
 * The hard zero: a case whose answer claims absent what the corpus carries
 * fails whatever the judge said. The judge cannot see it — it reads the same
 * fragments the model did — so its pass is kept in `verdicts` and only the
 * case's verdict and reason change.
 */
export function withAbsenceGate<T extends { verdict: Verdict; reason: string }>(
  judged: T,
  checks: AnswerChecks | null,
): T {
  const claims = checks?.absence.falseClaims ?? [];
  if (claims.length === 0) return judged;
  return {
    ...judged,
    verdict: "fail",
    reason:
      `false corpus-absence claim (#500): ` +
      claims.map((claim) => claim.target).join("; "),
  };
}

/** Every false absence claim in `rows`, one line each: the lanes' zero gate. */
export function falseAbsenceFailures(
  rows: readonly { id: string; checks: AnswerChecks | null }[],
): string[] {
  return rows.flatMap(({ id, checks }) =>
    (checks?.absence.falseClaims ?? []).map((claim) =>
      describeFalseAbsence(id, claim),
    ),
  );
}

/**
 * A lane's console block: the false absence claims (each already a failed
 * case), then what is reported and never gated — answers that open with an
 * absence claim, and typo runs. Rows with `null` checks (weak-retrieval
 * declines, a fixed text) are left out of every count.
 */
export function formatAnswerChecks(
  rows: readonly { id: string; checks: AnswerChecks | null }[],
): string {
  const checked = rows.flatMap(({ id, checks }) =>
    checks === null ? [] : [{ id, checks }],
  );
  const claims = falseAbsenceFailures(checked);
  const openings = checked.filter(({ checks }) => checks.absence.opening);
  const typos = checked.filter(({ checks }) => checks.typos.length > 0);
  return [
    `false absence claims (#500): ${claims.length}`,
    ...claims.map((claim) => `  ${claim}`),
    `opens with an absence claim (reported): ${openings.length}/${checked.length}` +
      (openings.length > 0 ? ` — ${openings.map((c) => c.id).join(", ")}` : ""),
    `typo runs (reported): ${typos.length}` +
      (typos.length > 0
        ? ` — ${typos.map((c) => `${c.id} (${c.checks.typos.join(", ")})`).join("; ")}`
        : ""),
  ].join("\n");
}
