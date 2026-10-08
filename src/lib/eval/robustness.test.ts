/**
 * The robustness block's composition (#502), and the module that keeps it
 * beside the gates.
 *
 * A robustness case is only worth its miss if the miss is the wording's: the
 * same targets and requirements as the seed it re-asks, copied rather than
 * re-derived. So the copy is checked field by field here, and the block's
 * shapes are counted, because «about 25 cases of five shapes» is a
 * composition nobody sees drift unless it is pinned.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SEED_PILLS } from "@/components/chat/seed-prompts";
import {
  DATASET_PATH,
  isRobustness,
  parseDataset,
  robustnessSeedId,
  type EvalCase,
} from "./dataset";
import {
  formatRobustnessLine,
  ROBUSTNESS_HIT_BASELINE,
  robustnessHitFloor,
  ROBUSTNESS_REGRESSION_MARGIN,
  splitRobustness,
} from "./robustness";

const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
const byId = new Map(cases.map((c) => [c.id, c]));
const block = cases.filter(isRobustness);
const shape = (prefix: string) =>
  block.filter((c) => c.id.startsWith(`rb-${prefix}-`));

/** Words as a reader counts them: punctuation is not a word. */
function wordCount(question: string): number {
  return question
    .replace(/[¿?¡!,.]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "").length;
}

describe("the robustness block (#502)", () => {
  it("holds about 25 cases, each of one of the five shapes", () => {
    expect(block.length).toBeGreaterThanOrEqual(25);
    const shapes = ["pill", "corto", "tilde", "spanglish", "seguimiento"];
    for (const c of block) {
      expect(
        shapes.some((s) => c.id.startsWith(`rb-${s}-`)),
        c.id,
      ).toBe(true);
    }
  });

  it("asks every seed pill's label verbatim, re-asking the question the pill sends", () => {
    const pills = shape("pill");
    expect(pills.map((c) => c.question).sort()).toEqual(
      SEED_PILLS.map((pill) => pill.label).sort(),
    );
    for (const pill of SEED_PILLS) {
      const c = pills.find((p) => p.question === pill.label)!;
      expect(byId.get(robustnessSeedId(c)!)?.question, c.id).toBe(
        pill.question,
      );
    }
  });

  it("asks about eight bare questions of three to five words", () => {
    const short = shape("corto");
    expect(short.length).toBeGreaterThanOrEqual(8);
    for (const c of short) {
      expect(wordCount(c.question), c.id).toBeGreaterThanOrEqual(3);
      expect(wordCount(c.question), c.id).toBeLessThanOrEqual(5);
    }
  });

  it("asks about five as typed on a phone: no accents, no ¿", () => {
    const phone = shape("tilde");
    expect(phone.length).toBeGreaterThanOrEqual(5);
    for (const c of phone) {
      expect(c.question, c.id).not.toMatch(/[áéíóúüñ¿?]/i);
    }
  });

  it("asks two in Spanglish", () => {
    expect(shape("spanglish")).toHaveLength(2);
  });

  it("asks three follow-ups of three or more turns", () => {
    const followUps = shape("seguimiento");
    expect(followUps).toHaveLength(3);
    for (const c of followUps) {
      expect(c.history?.length ?? 0, c.id).toBeGreaterThanOrEqual(2);
    }
  });

  it("re-asks a case outside the block, and carries its targets and requirements verbatim", () => {
    const copied = [
      "expected",
      "tier",
      "family",
      "requiredClaims",
      "requiredSteps",
      "freshness",
    ] as const satisfies readonly (keyof EvalCase)[];
    for (const c of block) {
      const seed = byId.get(robustnessSeedId(c)!);
      expect(seed, `${c.id}: no case ${robustnessSeedId(c)}`).toBeDefined();
      expect(isRobustness(seed!), c.id).toBe(false);
      for (const field of copied) {
        expect(c[field], `${c.id}.${field}`).toEqual(seed![field]);
      }
      expect(c.question, c.id).not.toBe(seed!.question);
    }
  });

  it("is never held out and never blocking", () => {
    for (const c of block) {
      expect(c.heldOut, c.id).toBe(false);
      expect(c.blocking, c.id).toBe(false);
    }
  });
});

describe("splitRobustness", () => {
  it("leaves every gate the population it had before the block", () => {
    const { gated, block: mine } = splitRobustness(cases, (c) => c);
    expect(mine).toEqual(block);
    expect(gated.some(isRobustness)).toBe(false);
    expect(gated.length + mine.length).toBe(cases.length);
  });
});

describe("robustnessHitFloor", () => {
  it("has no floor until a baseline is set", () => {
    expect(robustnessHitFloor(null)).toBeNull();
  });

  it("sits the margin below a baseline", () => {
    expect(robustnessHitFloor(24)).toBe(24 - ROBUSTNESS_REGRESSION_MARGIN);
  });

  it("is armed at 25 of 27 hits, #511's lane, failing a lane at 22 or below", () => {
    expect(ROBUSTNESS_HIT_BASELINE).toBe(25);
    expect(robustnessHitFloor()).toBe(23);
  });
});

describe("formatRobustnessLine", () => {
  it("counts the block and names each miss beside its seed", () => {
    const pills = shape("pill").slice(0, 2);
    const line = formatRobustnessLine(
      "hit-rate",
      pills,
      (c) => c,
      (c) => c === pills[0],
      () => "pool#—",
    );
    expect(line.split("\n")).toEqual([
      "hit-rate, robustness block (#502): 1/2",
      `  MISS  ${pills[1].id} ← ${robustnessSeedId(pills[1])}  «${pills[1].question}»  pool#—`,
    ]);
  });
});
