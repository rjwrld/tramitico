import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  caseHit,
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
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

  it("holds 25±5 cases (SPEC §9)", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(cases.length).toBeLessThanOrEqual(30);
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
});
