/**
 * `classifyRouting` over the whole eval dataset (#503): free, no database.
 *
 * The classifier runs only when retrieval is weak (route.ts; ADR 0017, kept
 * that way by the decision on #503), and an out-of-scope question often
 * retrieves well enough to reach the model, so the paid lanes can go a whole
 * run without streaming a routed decline. This file reads every case through
 * the classifier instead, in two halves:
 *
 * - Every abstention case classifies to its `routedCategory`. That is the
 *   decline the route streams if the case comes back weak, and `routeTo`
 *   names the same destination for the judge.
 * - The answerable cases the classifier would send out of scope, if it ever
 *   ran before retrieval, are listed and never failed. Today they reach the
 *   model, which answers them; the list is the standing evidence against an
 *   early keyword decline («¿Puedo inscribirme en Hacienda con mi DIMEX?»
 *   reads as migración).
 *
 * A follow-up is read on its own words here, while the route classifies the
 * condensed question. That needs a model, and no abstention case has turns.
 *
 * Vitest hides a passing test's console output, so the list prints with
 *
 *   pnpm vitest run --project unit --silent=false src/lib/eval/routing-dataset.test.ts
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { classifyRouting, OUT_OF_SCOPE, type RoutedCategory } from "../routing";
import {
  abstentionCases,
  DATASET_PATH,
  parseDataset,
  retrievalCases,
} from "./dataset";

const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));

const outOfScope: readonly RoutedCategory[] = OUT_OF_SCOPE;

describe("classifyRouting over eval/dataset.jsonl (#503)", () => {
  it("routes every abstention case to its routedCategory", () => {
    const abstentions = abstentionCases(cases);
    expect(abstentions.length).toBeGreaterThanOrEqual(15);
    const misrouted = abstentions
      .map((c) => ({
        id: c.id,
        expected: c.routedCategory,
        got: classifyRouting(c.question),
      }))
      .filter((row) => row.got !== row.expected);
    expect(misrouted).toEqual([]);
  });

  it("covers the institutions #503 added a case for", () => {
    const routed = new Set(abstentionCases(cases).map((c) => c.routedCategory));
    for (const category of ["migracion", "ins", "cosevi", "municipal"]) {
      expect(routed, category).toContain(category);
    }
  });

  // No assertion, by decision (#503): routing runs only on weak retrieval, so
  // these cases reach the model and are answered. A pinned list would fail the
  // next answerable case that mentions an institution, which is the failure
  // the decision ruled out.
  it("lists, without failing, the answerable cases an early decline would turn away", () => {
    const early = retrievalCases(cases)
      .map((c) => ({ id: c.id, category: classifyRouting(c.question) }))
      .filter((row) => outOfScope.includes(row.category));
    if (early.length > 0) {
      console.info(
        `#503: answerable cases classifyRouting reads as out of scope ` +
          `(harmless while routing runs only on weak retrieval): ` +
          early.map((row) => `${row.id} → ${row.category}`).join(", "),
      );
    }
  });
});
