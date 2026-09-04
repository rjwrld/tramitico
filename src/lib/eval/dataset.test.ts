import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  abstentionCases,
  caseHit,
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
  retrievalCases,
} from "./dataset";

const line = (obj: object) => JSON.stringify(obj);

const CASE = {
  id: "q1",
  seed: "corpus",
  question: "¿Pregunta?",
  expected: [{ docKey: "ley-iva", articulo: "Artículo 8" }],
};

describe("parseDataset", () => {
  it("parses one case per line and skips blank lines", () => {
    const cases = parseDataset(
      `${line(CASE)}\n\n${line({ ...CASE, id: "q2" })}\n`,
    );
    expect(cases.map((c) => c.id)).toEqual(["q1", "q2"]);
    expect(cases[0].expected).toEqual(CASE.expected);
    expect(cases[0].blocking).toBe(false);
  });

  it("keeps the blocking flag", () => {
    const cases = parseDataset(line({ ...CASE, blocking: true }));
    expect(cases[0].blocking).toBe(true);
  });

  it("rejects duplicate ids", () => {
    expect(() => parseDataset(`${line(CASE)}\n${line(CASE)}`)).toThrow(
      /duplicate/i,
    );
  });

  it("rejects a case without expected targets", () => {
    expect(() => parseDataset(line({ ...CASE, expected: [] }))).toThrow(
      /expected/i,
    );
    expect(() =>
      parseDataset(line({ id: "x", seed: "corpus", question: "¿?" })),
    ).toThrow(/expected/i);
  });

  it("rejects a case missing id or question", () => {
    expect(() => parseDataset(line({ ...CASE, id: "" }))).toThrow(/id/i);
    expect(() => parseDataset(line({ ...CASE, question: "" }))).toThrow(
      /question/i,
    );
  });

  it("rejects malformed JSON with the offending line number", () => {
    expect(() => parseDataset(`${line(CASE)}\nnot json`)).toThrow(/line 2/i);
  });
});

describe("parseDataset coverage contract (#261)", () => {
  const TIER1 = {
    ...CASE,
    tier: 1,
    family: "T1-D",
    requiredClaims: [
      "el hecho generador ocurre al prestar el servicio",
      { claim: "la tarifa general es 13 %", literal: ["13 %", "13%"] },
    ],
    requiredSteps: ["declarar en TRIBU-CR"],
    freshness: ["ley-iva"],
  };
  const ABSTAIN = {
    id: "fuera-de-alcance",
    seed: "held-out",
    question: "¿Cuánto cobro por hora?",
    tier: "abstain",
    abstainIf: "no existe fuente oficial de tarifas de mercado",
    routeTo: "un colegio profesional",
  };

  it("defaults a case with no tier to tier 2, non-blocking", () => {
    const [only] = parseDataset(line(CASE));
    expect(only.tier).toBe(2);
    expect(only.blocking).toBe(false);
    expect(only.requiredClaims).toBeUndefined();
  });

  it("keeps the whole contract of a tier 1 case, blocking by default", () => {
    const [only] = parseDataset(line(TIER1));
    expect(only.tier).toBe(1);
    expect(only.family).toBe("T1-D");
    expect(only.blocking).toBe(true);
    // A bare string is the judged form; the object form carries the literals.
    expect(only.requiredClaims).toEqual([
      { claim: "el hecho generador ocurre al prestar el servicio" },
      { claim: "la tarifa general es 13 %", literal: ["13 %", "13%"] },
    ]);
    expect(only.requiredSteps).toEqual(["declarar en TRIBU-CR"]);
    expect(only.freshness).toEqual(["ley-iva"]);
  });

  it("refuses a tier 1 case that does not carry what makes it checkable", () => {
    expect(() => parseDataset(line({ ...TIER1, family: undefined }))).toThrow(
      /family/,
    );
    expect(() =>
      parseDataset(line({ ...TIER1, requiredClaims: undefined })),
    ).toThrow(/requiredClaims/);
    expect(() => parseDataset(line({ ...TIER1, blocking: false }))).toThrow(
      /always blocking/,
    );
  });

  it("rejects an unknown tier or family", () => {
    expect(() => parseDataset(line({ ...CASE, tier: 3 }))).toThrow(/tier/);
    expect(() => parseDataset(line({ ...TIER1, family: "T1-Z" }))).toThrow(
      /family/,
    );
  });

  it("caps requiredClaims at five", () => {
    expect(() =>
      parseDataset(
        line({ ...TIER1, requiredClaims: ["a", "b", "c", "d", "e", "f"] }),
      ),
    ).toThrow(/at most 5/);
  });

  it("rejects an empty or malformed claim, step or freshness list", () => {
    expect(() => parseDataset(line({ ...TIER1, requiredClaims: [] }))).toThrow(
      /non-empty array/,
    );
    expect(() =>
      parseDataset(
        line({ ...TIER1, requiredClaims: [{ claim: "x", literal: [] }] }),
      ),
    ).toThrow(/literal must be a non-empty array/);
    expect(() =>
      parseDataset(line({ ...TIER1, requiredClaims: [{}] })),
    ).toThrow(/claim/);
    expect(() => parseDataset(line({ ...TIER1, requiredSteps: [""] }))).toThrow(
      /requiredSteps must hold non-empty strings/,
    );
    expect(() => parseDataset(line({ ...TIER1, freshness: [] }))).toThrow(
      /freshness must be a non-empty array/,
    );
  });

  it("lets an abstention case carry no expected target, and requires abstainIf", () => {
    const [only] = parseDataset(line(ABSTAIN));
    expect(only.expected).toEqual([]);
    expect(only.blocking).toBe(false);
    expect(only.routeTo).toBe("un colegio profesional");
    expect(() =>
      parseDataset(line({ ...ABSTAIN, abstainIf: undefined })),
    ).toThrow(/abstainIf/);
    expect(() =>
      parseDataset(line({ ...ABSTAIN, expected: CASE.expected })),
    ).toThrow(/no expected targets/);
  });

  it("still demands expected targets on every other tier", () => {
    expect(() => parseDataset(line({ ...CASE, expected: undefined }))).toThrow(
      /missing expected targets/,
    );
  });

  it("splits the lanes: abstention cases out of retrieval, and only them in", () => {
    const cases = parseDataset(`${line(TIER1)}\n${line(ABSTAIN)}`);
    expect(retrievalCases(cases).map((c) => c.id)).toEqual([TIER1.id]);
    expect(abstentionCases(cases).map((c) => c.id)).toEqual([ABSTAIN.id]);
  });
});

describe("parseDataset history (#132)", () => {
  const HISTORY = [
    { question: "¿Y en la CCSS?", answer: "Como independiente." },
  ];

  it("keeps the turns of a condensation case, and nothing on the others", () => {
    const [followUp, plain] = parseDataset(
      `${line({ ...CASE, history: HISTORY })}\n${line({ ...CASE, id: "q2" })}`,
    );
    expect(followUp.history).toEqual(HISTORY);
    // Absent, not empty: `history === undefined` is what the eval reads as
    // "this case makes no condensation call".
    expect(plain.history).toBeUndefined();
  });

  it("rejects a history that cannot be condensed against", () => {
    expect(() => parseDataset(line({ ...CASE, history: [] }))).toThrow(
      /non-empty array/,
    );
    expect(() =>
      parseDataset(line({ ...CASE, history: [{ question: "¿Y?" }] })),
    ).toThrow(/needs a question and an answer/);
  });
});

describe("chunkMatchesTarget", () => {
  const chunk = {
    docKey: "ley-9635",
    articulo: "Artículo 8",
    path: ["TÍTULO I", "CAPÍTULO III"],
  };

  it("requires the docKey to match", () => {
    expect(
      chunkMatchesTarget(chunk, { docKey: "ley-iva", articulo: "Artículo 8" }),
    ).toBe(false);
  });

  it("matches the artículo exactly, case-insensitively", () => {
    expect(
      chunkMatchesTarget(chunk, { docKey: "ley-9635", articulo: "ARTÍCULO 8" }),
    ).toBe(true);
    // Exact equality, not prefix: "Artículo 8" must not match "Artículo 80".
    expect(
      chunkMatchesTarget(
        { ...chunk, articulo: "Artículo 80" },
        { docKey: "ley-9635", articulo: "Artículo 8" },
      ),
    ).toBe(false);
  });

  it("treats a target without artículo as doc-level", () => {
    expect(chunkMatchesTarget(chunk, { docKey: "ley-9635" })).toBe(true);
    expect(
      chunkMatchesTarget({ ...chunk, articulo: null }, { docKey: "ley-9635" }),
    ).toBe(true);
  });

  it("never matches an artículo target against a chunk without artículo", () => {
    expect(
      chunkMatchesTarget(
        { ...chunk, articulo: null },
        { docKey: "ley-9635", articulo: "Artículo 8" },
      ),
    ).toBe(false);
  });

  it("disambiguates repeated artículo labels by exact path element", () => {
    const target = {
      docKey: "ley-9635",
      articulo: "Artículo 8",
      pathIncludes: "TÍTULO I",
    };
    expect(chunkMatchesTarget(chunk, target)).toBe(true);
    // "TÍTULO I" is an exact element, not a prefix — TITULO II chunks stay out.
    expect(chunkMatchesTarget({ ...chunk, path: ["TITULO II"] }, target)).toBe(
      false,
    );
    expect(chunkMatchesTarget({ ...chunk, path: ["TÍTULO III"] }, target)).toBe(
      false,
    );
  });
});

describe("caseHit", () => {
  const chunks = [
    { docKey: "ley-iva", articulo: "Artículo 1", path: [] },
    { docKey: "reglamento-iva", articulo: "Artículo 11", path: [] },
  ];

  it("is a hit when any chunk matches any target", () => {
    expect(
      caseHit(chunks, [
        { docKey: "ley-9635", articulo: "Artículo 8" },
        { docKey: "reglamento-iva", articulo: "Artículo 11" },
      ]),
    ).toBe(true);
  });

  it("is a miss when no chunk matches", () => {
    expect(
      caseHit(chunks, [{ docKey: "ley-9635", articulo: "Artículo 8" }]),
    ).toBe(false);
  });
});

describe("eval/dataset.jsonl", () => {
  const cases = parseDataset(readFileSync(DATASET_PATH, "utf8"));

  it("holds 25–40 cases (SPEC §9)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(25);
    expect(cases.length).toBeLessThanOrEqual(40);
  });

  it("carries the #132 condensation cases, each with its turns", () => {
    const followUps = cases.filter((c) => c.history !== undefined);
    // The acceptance example from the issue, and enough siblings that a
    // single flaky rewrite cannot be mistaken for the mechanism failing.
    expect(followUps.map((c) => c.id)).toContain("ccss-asalariado-followup");
    expect(followUps.length).toBeGreaterThanOrEqual(3);
    for (const c of followUps) {
      expect(c.history!.length).toBeGreaterThan(0);
    }
  });

  it("names the canary as a blocking case", () => {
    const blocking = cases.filter((c) => c.blocking);
    expect(blocking.map((c) => c.id)).toContain("iva-clientes-fuera-cr");
  });

  it("only targets doc_keys that exist in the corpus manifest", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
    ) as { documents: { doc_key: string }[] };
    const known = new Set(manifest.documents.map((d) => d.doc_key));
    for (const c of cases) {
      for (const target of c.expected) {
        expect(
          known.has(target.docKey),
          `${c.id}: unknown doc_key ${target.docKey}`,
        ).toBe(true);
      }
    }
  });

  it("does not target or ingest a retired document", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "corpus", "manifest.json"), "utf8"),
    ) as {
      retiredDocKeys?: string[];
      retirementNotes?: Record<string, string>;
      documents: { doc_key: string }[];
    };
    const retired = new Set(manifest.retiredDocKeys ?? []);
    const active = new Set(manifest.documents.map((doc) => doc.doc_key));

    expect([...retired].filter((docKey) => active.has(docKey))).toEqual([]);
    expect(Object.keys(manifest.retirementNotes ?? {}).sort()).toEqual(
      [...retired].sort(),
    );
    for (const evalCase of cases) {
      for (const target of evalCase.expected) {
        expect(
          retired.has(target.docKey),
          `${evalCase.id}: retired doc_key ${target.docKey}`,
        ).toBe(false);
      }
    }
  });
});
