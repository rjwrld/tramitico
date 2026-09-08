import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach, vi } from "vitest";
import { DERIVED_FIGURES, formatCostaRicanColones } from "./derived";
import { parseCorpusIndex, CORPUS_INDEX_PATH } from "../eval/corpus-index";
import { DATASET_PATH, FAMILIES, parseDataset } from "../eval/dataset";
import {
  classifyFamily,
  STEP_CATALOGUE,
  stepProbe,
  stepsEnabled,
} from "./steps";

const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
const corpusIndex = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));

describe("the step catalogue (#304)", () => {
  it("carries two to four corpus-register sentences for every family", () => {
    // Four since #312: T1-B and T1-F carry, beside their three steps, the
    // line of the salarios mínimos decree that the BMC derivation multiplies
    // — an input the reader never names and no step sentence reached.
    for (const family of FAMILIES) {
      const { steps } = STEP_CATALOGUE[family];
      expect(steps.length, family).toBeGreaterThanOrEqual(2);
      expect(steps.length, family).toBeLessThanOrEqual(4);
      for (const sentence of steps) {
        expect(sentence.trim(), family).toBe(sentence);
        expect(sentence.length, family).toBeGreaterThan(40);
      }
    }
  });

  it("names, per family, the dataset cases it was written for — and only theirs", () => {
    for (const family of FAMILIES) {
      const { cases } = STEP_CATALOGUE[family];
      expect(cases.length, family).toBeGreaterThan(0);
      for (const id of cases) {
        const evalCase = dataset.find((c) => c.id === id);
        expect(
          evalCase,
          `${family}: ${id} is not in the dataset`,
        ).toBeDefined();
        expect(evalCase?.family, `${family}: ${id}`).toBe(family);
      }
    }
  });

  it("keeps the figure it quotes equal to the audited derived-figure input (#312)", () => {
    // The one catalogue sentence that carries a number rather than a step:
    // T1-B and T1-F quote the salarios mínimos table line the BMC
    // derivation multiplies. `salarios-minimos` churns annually (its
    // manifest entry says so), and a sentence quoting last year's colones
    // reaches nothing — the lexical leg's strict AND branch needs the
    // chunk's own token. So the sentence is pinned to the same audited value
    // `corpus/manifest.json` states for the input, and the annual update
    // fails here rather than silently in a pool rank.
    const input = DERIVED_FIGURES.flatMap((figure) => figure.inputs).find(
      (candidate) =>
        candidate.docKey === "salarios-minimos" &&
        candidate.articulo === "Artículo 1",
    );
    expect(input, "no salarios-minimos input in the manifest").toBeDefined();
    const formatted = formatCostaRicanColones(input!.value, input!.decimals);
    for (const family of ["T1-B", "T1-F"] as const) {
      const quoting = STEP_CATALOGUE[family].steps.filter((sentence) =>
        sentence.includes("Ocupación No Calificada"),
      );
      expect(quoting.length, family).toBe(1);
      expect(quoting[0], family).toContain(formatted);
    }
  });

  it("names chunks the committed corpus actually holds", () => {
    // The committed coverage dump (#163) is what makes this a unit test: a
    // catalogue sentence aimed at a chunk that was renamed or dropped is a
    // sentence that reaches nothing, and the eval lane is the wrong place to
    // learn that.
    const known = new Set(
      corpusIndex.entries.map(
        (entry) => `${entry.docKey} · ${entry.articulo ?? ""}`,
      ),
    );
    for (const family of FAMILIES) {
      for (const target of STEP_CATALOGUE[family].reaches) {
        const key = target.includes(" · ") ? target : `${target} · `;
        expect(known.has(key), `${family}: ${target}`).toBe(true);
      }
    }
  });
});

describe("classifyFamily (#304)", () => {
  it("names the family of every single-turn Tier 1 question in the dataset", () => {
    // Follow-ups are classified on their condensed form at run time, which
    // needs a model; the hit-rate harness prints that classification.
    const singleTurn = dataset.filter(
      (c) => c.family !== undefined && c.history === undefined,
    );
    expect(singleTurn.length).toBeGreaterThan(0);
    const wrong = singleTurn
      .filter((c) => classifyFamily(c.question) !== c.family)
      .map((c) => `${c.id}: ${c.family} → ${classifyFamily(c.question)}`);
    expect(wrong).toEqual([]);
  });

  it("classifies the condensed shape of a follow-up", () => {
    expect(
      classifyFamily(
        "¿Dónde me afilio a la CCSS como trabajadora independiente?",
      ),
    ).toBe("T1-B");
    expect(
      classifyFamily(
        "Dejé de trabajar por mi cuenta, ¿qué tengo que hacer en la Caja?",
      ),
    ).toBe("T1-H");
    expect(
      classifyFamily(
        "¿Hasta qué día tengo para presentar la declaración del IVA?",
      ),
    ).toBe("T1-D");
  });

  it("is null when nothing in the question names a family", () => {
    expect(classifyFamily("¿Qué contador me recomienda?")).toBeNull();
    expect(classifyFamily("")).toBeNull();
  });

  it("reads diacritics and case the way routing does", () => {
    expect(classifyFamily("¿CÓMO PIDO LA PRESCRIPCIÓN?")).toBe("T1-G");
    expect(classifyFamily("como pido la prescripcion")).toBe("T1-G");
  });

  it("matches whole words, not fragments", () => {
    // «ruta» is not «rut».
    expect(classifyFamily("¿cuál es la ruta al banco?")).toBeNull();
  });

  it("gives a tie to the later family — the situation, not the obligation", () => {
    // Inscription (T1-A) and lateness (T1-I), one hit each: the step the
    // reader needs is how to regularise the sanction.
    expect(classifyFamily("Me inscribí un año tarde, ¿qué me pasa?")).toBe(
      "T1-I",
    );
  });

  it("lets the count win over the order", () => {
    // Two T1-A hits against one T1-I hit.
    expect(classifyFamily("¿Cómo me inscribo en el RUT si me atrasé?")).toBe(
      "T1-A",
    );
  });
});

describe("stepProbe (#304)", () => {
  it("returns the family and its sentences, as a copy", () => {
    const probe = stepProbe("¿Me puedo desinscribir si debo declaraciones?");
    expect(probe?.family).toBe("T1-H");
    expect(probe?.sentences).toEqual(STEP_CATALOGUE["T1-H"].steps);
    expect(probe?.sentences).not.toBe(STEP_CATALOGUE["T1-H"].steps);
  });

  it("is null for a question of no family", () => {
    expect(stepProbe("¿Qué contador me recomienda?")).toBeNull();
  });
});

describe("stepsEnabled", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is on by default, and when CI interpolates an unset variable as empty", () => {
    vi.stubEnv("STEPS", "");
    expect(stepsEnabled()).toBe(true);
  });

  it("is off only on an explicit STEPS=off", () => {
    vi.stubEnv("STEPS", "off");
    expect(stepsEnabled()).toBe(false);
    vi.stubEnv("STEPS", "on");
    expect(stepsEnabled()).toBe(true);
  });
});
