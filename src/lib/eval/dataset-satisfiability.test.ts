/**
 * The per-PR satisfiability census (issue #163).
 *
 * Same guard as `dataset-satisfiability.eval.test.ts`, run against the
 * committed `eval/corpus-index.json` instead of `public.chunks`: a PR that
 * adds a target no ingested chunk can satisfy goes red here, with no database
 * and no secrets. The eval-lane twin stays as the backstop that catches the
 * fixture itself going stale.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CORPUS_INDEX_PATH, parseCorpusIndex } from "./corpus-index";
import { DATASET_PATH, parseDataset } from "./dataset";
import {
  censusTargets,
  formatCensus,
  unsatisfiableTargets,
} from "./satisfiability";

describe("eval dataset targets are satisfiable by the committed corpus index", () => {
  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const index = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));
  const census = censusTargets(cases, index.entries);

  it("has at least one indexed chunk for every expected target", () => {
    const unsatisfiable = unsatisfiableTargets(census);
    expect(
      unsatisfiable,
      `expected targets no ingested chunk can satisfy:\n  ${unsatisfiable.join("\n  ")}\n\n${formatCensus(census, index.chunkCount)}`,
    ).toEqual([]);
  });

  it("indexes every doc_key the dataset expects", () => {
    const indexed = new Set(index.entries.map((entry) => entry.docKey));
    const expected = [
      ...new Set(
        cases.flatMap((evalCase) =>
          evalCase.expected.map((target) => target.docKey),
        ),
      ),
    ];
    expect(expected.filter((docKey) => !indexed.has(docKey))).toEqual([]);
  });
});
