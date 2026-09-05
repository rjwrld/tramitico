/**
 * The held-out set's composition contract (#261 part B, #254 Part A §A5 /
 * Part B §B8).
 *
 * `dataset.test.ts` checks that a case *parses*; this file checks that the
 * set as a whole is the one the coverage contract promises. The distinction
 * matters because every individual case here could be valid while the set
 * quietly lost a family, or measured T1-D three times in three phrasings and
 * T1-G never — and the promise "the nine Tier 1 families are covered" would
 * still read as kept. A coverage claim nobody counts is a coverage claim
 * nobody has.
 *
 * The numbers come from §B8: nine families × three variants, twelve Tier 2
 * cases, nine abstention cases. Only the Tier 1 grid is pinned exactly; Tier 2
 * and abstention are floors, and the asymmetry is deliberate. A tenth Tier 2
 * topic or abstention case only widens what is measured, but a second
 * `coloquial` variant of one family would make "every Tier 1 case is
 * individually blocking" mean something different for that family than for
 * the other eight — so that grid is the one number that may not drift.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { figureMentions } from "./adequacy";
import { CORPUS_INDEX_PATH, parseCorpusIndex } from "./corpus-index";
import {
  abstentionCases,
  DATASET_PATH,
  FAMILIES,
  heldOutCases,
  MAX_REQUIRED_CLAIMS,
  parseDataset,
  VARIANTS,
} from "./dataset";

const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));
const heldOut = heldOutCases(cases);
const tier1 = heldOut.filter((c) => c.tier === 1);
const tier2 = heldOut.filter((c) => c.tier === 2);
const abstain = abstentionCases(heldOut);

describe("the held-out set (#261 part B)", () => {
  it("holds at least the 45 cases the acceptance asks for", () => {
    expect(heldOut.length).toBeGreaterThanOrEqual(45);
    expect(tier1.length + tier2.length + abstain.length).toBe(heldOut.length);
  });

  it("covers every Tier 1 family in all three variants, exactly once", () => {
    const grid = tier1.map((c) => `${c.family}/${c.variant}`).sort();
    const expected = FAMILIES.flatMap((family) =>
      VARIANTS.map((variant) => `${family}/${variant}`),
    ).sort();
    expect(grid).toEqual(expected);
  });

  it("carries at least the twelve Tier 2 and nine abstention cases", () => {
    expect(tier2.length).toBeGreaterThanOrEqual(12);
    expect(abstain.length).toBeGreaterThanOrEqual(9);
  });
});

/**
 * The seven cases #258/#259/#260 had already put in the dataset before this
 * issue promoted them into the set. Flagging a case `heldOut` cannot undo the
 * exposure it already had — the retrieval suite has been running them — so
 * they are *members* of the held-out set but not *first exposures* of it, and
 * #267 has to report the two groups separately or its held-out number will
 * claim more than it measured.
 *
 * `seed` is what tells them apart: a case written for this set carries
 * `held-out:<family>`, a promoted one keeps the provenance of the issue that
 * wrote it. Pinning the list here means the distinction survives someone
 * later editing a seed without knowing what it was load-bearing for.
 */
const PROMOTED = [
  "ccss-cese-actividad",
  "ccss-obligacion-ingreso-bajo",
  "ccss-pedir-prescripcion-cuotas",
  "ccss-ventana-prescripcion-24-meses",
  "desinscripcion-dejar-actividad",
  "inscripcion-tardia-sancion",
  "multa-iva-no-declarado",
];

describe("first exposure vs. promoted membership (#261 part B)", () => {
  const promoted = heldOut
    .filter((c) => !c.seed.startsWith("held-out:"))
    .map((c) => c.id)
    .sort();

  it("keeps the promoted cases identifiable by their original seed", () => {
    expect(promoted).toEqual(PROMOTED);
  });

  it("leaves the rest genuinely unseen before this set", () => {
    // 48 members, 7 of them promoted: 41 questions no eval run has scored.
    expect(heldOut.length - promoted.length).toBeGreaterThanOrEqual(41);
  });
});

describe("every held-out Tier 1 case carries what makes it checkable", () => {
  it("is blocking, with a family and at most five required claims", () => {
    for (const c of tier1) {
      expect(c.blocking, c.id).toBe(true);
      expect(c.family, c.id).toBeDefined();
      expect(c.requiredClaims, c.id).toBeDefined();
      expect(c.requiredClaims!.length, c.id).toBeGreaterThan(0);
      expect(c.requiredClaims!.length, c.id).toBeLessThanOrEqual(
        MAX_REQUIRED_CLAIMS,
      );
    }
  });

  it("names the sources whose figures it depends on (§B8 freshness)", () => {
    for (const c of tier1) {
      expect(c.freshness, c.id).toBeDefined();
      expect(c.freshness!.length, c.id).toBeGreaterThan(0);
    }
  });

  it("owes the reader next steps on every family (§B4)", () => {
    for (const c of tier1) {
      expect(c.requiredSteps, c.id).toBeDefined();
      expect(c.requiredSteps!.length, c.id).toBeGreaterThan(0);
    }
  });

  it("checks the figures and dates deterministically, not by judge (req. 3)", () => {
    // The six §B8 figures the contract names by hand. Each must reach the
    // deterministic lane — a `literal` claim — somewhere in the set, because
    // a number a judge reads is a number nobody checked.
    const literals = tier1.flatMap((c) =>
      (c.requiredClaims ?? []).flatMap((claim) => claim.literal ?? []),
    );
    for (const figure of [
      "13 %",
      "6.244.000",
      "373.092,30",
      "cuatro años",
      "diez años",
      "día 15",
      "dos meses y quince días",
    ]) {
      expect(literals, `no deterministic check for ${figure}`).toContain(
        figure,
      );
    }
  });

  it("spells a literal the way an answer would print it", () => {
    for (const c of tier1) {
      for (const claim of c.requiredClaims ?? []) {
        for (const variant of claim.literal ?? []) {
          // A leading/trailing space or an empty string would match every
          // answer or none; both are silent passes.
          expect(variant, c.id).toBe(variant.trim());
          expect(variant.length, c.id).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe("the held-out abstention block", () => {
  it("declares what obliges the decline and where to send the reader", () => {
    for (const c of abstain) {
      expect(c.abstainIf, c.id).toBeTruthy();
      expect(c.routeTo, c.id).toBeTruthy();
      expect(c.expected, c.id).toEqual([]);
    }
  });

  it("seeds no figure in the question itself", () => {
    // `figureMentions` counts every colón amount and percentage in the answer
    // as invented. A question that hands the model a figure invites it to
    // echo one back, which would fail the case for the wrong reason — so the
    // check runs the *same* detector over the question, rather than a second
    // regex that could drift away from it.
    for (const c of abstain) {
      expect(figureMentions(c.question), c.id).toEqual([]);
    }
  });
});

describe("the held-out set is answerable by the committed corpus", () => {
  const index = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));

  it("names only docKeys the freshness contract can point at", () => {
    const indexed = new Set(index.entries.map((entry) => entry.docKey));
    const unknown = heldOut
      .flatMap((c) => (c.freshness ?? []).map((docKey) => `${c.id}: ${docKey}`))
      .filter((row) => !indexed.has(row.split(": ")[1]));
    expect(unknown).toEqual([]);
  });

  it("gives every non-abstention held-out case a retrieval target", () => {
    for (const c of [...tier1, ...tier2]) {
      expect(c.expected.length, c.id).toBeGreaterThan(0);
    }
  });
});
