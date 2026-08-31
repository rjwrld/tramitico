/**
 * The satisfiability census (issue #111), as a pure function over chunks.
 *
 * Every expected target in `eval/dataset.jsonl` must be matched by at least
 * one ingested chunk. The hit-rate eval cannot catch this class: `caseHit`
 * succeeds when *any one* expected target is satisfied, so a multi-target
 * case can carry a permanently unsatisfiable target and stay green forever.
 * This sweep checks every target on its own.
 *
 * Two callers run it over two sources of chunks (#163):
 * `dataset-satisfiability.test.ts` over the committed `eval/corpus-index.json`
 * on every PR, and `dataset-satisfiability.eval.test.ts` over the real
 * `public.chunks` in the corpus lane.
 *
 * Note the deliberate limit of the guard: a target with no `articulo` is
 * satisfied by any chunk of its document (`chunkMatchesTarget` returns early),
 * so it passes by construction. That is Class A only; whether the document's
 * text actually supports the case's claim is Class B — a judgment read, not a
 * predicate (see the PR for issue #111).
 */
import {
  chunkMatchesTarget,
  type EvalCase,
  type ExpectedTarget,
  type MatchableChunk,
} from "./dataset";

export interface TargetCensusRow {
  caseId: string;
  target: ExpectedTarget;
  matchCount: number;
}

export function describeTarget(target: ExpectedTarget): string {
  const parts = [target.docKey];
  if (target.articulo !== undefined) parts.push(target.articulo);
  if (target.pathIncludes !== undefined) parts.push(`@${target.pathIncludes}`);
  return parts.join(" · ");
}

export function censusTargets(
  cases: readonly EvalCase[],
  chunks: readonly MatchableChunk[],
): TargetCensusRow[] {
  const census: TargetCensusRow[] = [];
  for (const evalCase of cases) {
    for (const target of evalCase.expected) {
      census.push({
        caseId: evalCase.id,
        target,
        matchCount: chunks.filter((chunk) => chunkMatchesTarget(chunk, target))
          .length,
      });
    }
  }
  return census;
}

/** The census rows no chunk satisfies, rendered for an assertion message. */
export function unsatisfiableTargets(
  census: readonly TargetCensusRow[],
): string[] {
  return census
    .filter((row) => row.matchCount === 0)
    .map((row) => `${row.caseId} → ${describeTarget(row.target)}`);
}

export function formatCensus(
  census: readonly TargetCensusRow[],
  chunkCount: number,
): string {
  const satisfied = census.filter((row) => row.matchCount > 0).length;
  const lines = [
    `dataset target census (${chunkCount} chunks): ${satisfied}/${census.length} targets satisfiable`,
  ];
  for (const row of census) {
    lines.push(
      `  ${row.matchCount > 0 ? "ok  " : "MISS"}  ${String(row.matchCount).padStart(3)} chunk(s)  ${row.caseId}  →  ${describeTarget(row.target)}`,
    );
  }
  return lines.join("\n");
}
