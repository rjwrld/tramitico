import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CARRIERS_PATH, parseCarriers, parseChunkRef } from "./carriers";
import { CORPUS_INDEX_PATH, parseCorpusIndex } from "./corpus-index";
import { chunkMatchesTarget, DATASET_PATH, parseDataset } from "./dataset";

const carriers = parseCarriers(readFileSync(CARRIERS_PATH, "utf8"));
const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
const corpusIndex = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));

describe("parseChunkRef", () => {
  it("splits on the first separator only, so a FAQ entry keeps its own", () => {
    expect(parseChunkRef("tribu-cr-faq · Declaraciones del RUT · 2")).toEqual({
      docKey: "tribu-cr-faq",
      articulo: "Declaraciones del RUT · 2",
    });
    expect(parseChunkRef("cabys-dev")).toEqual({ docKey: "cabys-dev" });
  });
});

describe("parseCarriers", () => {
  it("rejects a file without cases, or a case without chunks", () => {
    expect(() => parseCarriers("{}")).toThrow(/cases/);
    expect(() => parseCarriers('{"cases":{"x":[]}}')).toThrow(/x/);
  });
});

describe("eval/tier1-carriers.json (#287)", () => {
  it("names dataset cases: Tier 1 ones, and F1's BMC case", () => {
    for (const id of carriers.keys()) {
      const evalCase = dataset.find((c) => c.id === id);
      expect(evalCase, `${id} is not in the dataset`).toBeDefined();
      if (id !== "ccss-cuanto-pago-base") expect(evalCase?.tier, id).toBe(1);
    }
  });

  it("names chunks the committed corpus holds", () => {
    for (const [id, targets] of carriers) {
      for (const target of targets) {
        expect(
          corpusIndex.entries.some((entry) =>
            chunkMatchesTarget(entry, target),
          ),
          `${id}: ${target.docKey} · ${target.articulo ?? "*"}`,
        ).toBe(true);
      }
    }
  });
});
