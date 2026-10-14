import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CORPUS_INDEX_PATH,
  parseCorpusIndex,
} from "../src/lib/eval/corpus-index";
import {
  chunkMatchesTarget,
  DATASET_PATH,
  parseDataset,
} from "../src/lib/eval/dataset";
import {
  carriedBy,
  carrierRecall,
  formatReport,
  jaccard,
  meanShare,
  median,
  parseCarrierList,
  parseSetLabel,
  type CarrierRow,
  type Draw,
  type ProbeRead,
} from "./carrier-recall";

const CONFIG = "top8/capoff/pinon";

const read = (
  id: string,
  set: string[],
  extra: Partial<ProbeRead> & {
    present?: number;
    pins?: Record<string, string>;
  } = {},
): ProbeRead => {
  const { present = 1, pins, ...rest } = extra;
  return {
    id,
    kind: "retrieval",
    tier: 1,
    variant: "literal",
    weak: false,
    expectedCount: 1,
    steps: null,
    failures: { rerank: 0 },
    rerankReadings: { dropped: [] },
    per: {
      [CONFIG]: {
        present,
        size: set.length,
        set,
        chunkIds: set.map((label) => `id:${label}`),
        ...(pins === undefined ? {} : { pins }),
      },
    },
    ...rest,
  };
};

const row = (caseId: string, ...parts: string[][]): CarrierRow =>
  parseCarrierList(
    JSON.stringify({
      requirements: [
        {
          case: caseId,
          requirement: "r",
          sources: ["test"],
          parts: parts.map((carriers) => ({ what: "w", carriers })),
        },
      ],
    }),
  )[0];

const RUT2 = "tribu-cr-faq·Declaraciones del RUT · 2·#0";
const CNPT79 = "cnpt·Artículo 79·#0";
const LEY22 = "ley-renta·ARTICULO 22·#1";
const TRAMOS = "tramos-renta-2026·*·#0";

describe("parseSetLabel", () => {
  it("keeps a FAQ entry's own separator in the articulo, and reads * as none", () => {
    expect(parseSetLabel(RUT2)).toEqual({
      docKey: "tribu-cr-faq",
      articulo: "Declaraciones del RUT · 2",
      path: [],
    });
    expect(parseSetLabel(TRAMOS)).toEqual({
      docKey: "tramos-renta-2026",
      articulo: null,
      path: [],
    });
  });
});

describe("carriedBy", () => {
  it("needs a carrier for every part, any one of each part's alternatives", () => {
    const twoParts = row(
      "c",
      ["reglamento-iva · Artículo 40", "ley-iva · Artículo 27"],
      ["cnpt · Artículo 79"],
    );
    expect(carriedBy(twoParts, ["ley-iva·Artículo 27·#0", CNPT79])).toBe(true);
    expect(carriedBy(twoParts, ["ley-iva·Artículo 27·#0"])).toBe(false);
  });

  it("matches the articulo exactly, and a bare docKey on any chunk", () => {
    expect(carriedBy(row("c", ["cnpt · Artículo 7"]), [CNPT79])).toBe(false);
    expect(carriedBy(row("c", ["ley-renta · ARTICULO 22"]), [LEY22])).toBe(
      true,
    );
    expect(carriedBy(row("c", ["tramos-renta-2026"]), [TRAMOS])).toBe(true);
  });
});

describe("parseCarrierList", () => {
  it("rejects a list without rows, or a row with an empty part", () => {
    expect(() => parseCarrierList("{}")).toThrow(/requirements/);
    expect(() =>
      parseCarrierList(
        '{"requirements":[{"case":"c","requirement":null,"parts":[{"carriers":[]}]}]}',
      ),
    ).toThrow(/row 1/);
  });
});

describe("jaccard and median", () => {
  it("reads two empty sets as identical, and takes the middle of an even list", () => {
    expect(jaccard([], [])).toBe(1);
    expect(jaccard(["a", "b"], ["b", "c"])).toBeCloseTo(1 / 3);
    expect(median([0.2, 1, 0.5, 0.4])).toBe(0.45);
    expect(median([])).toBeNull();
  });
});

describe("carrierRecall", () => {
  const list = [
    row("t1", ["cnpt · Artículo 79"]),
    row("t2", ["cnpt · Artículo 78"]),
  ];
  const draws: Draw[] = [
    {
      name: "d1",
      reads: [
        read("t1", [RUT2, CNPT79], {
          steps: "T1-H",
          pins: { [CNPT79]: "step" },
        }),
        read("t2", [RUT2], { present: 0 }),
        read("rb", [RUT2], { variant: "robustez", tier: null }),
        read("abs", [], { kind: "abstention", tier: "abstain", weak: true }),
      ],
    },
    {
      name: "d2",
      reads: [
        read("t1", [RUT2], { steps: "T1-H", pins: { [RUT2]: "step" } }),
        // A lost reading: out of this draw, from every count.
        read("t2", [CNPT79], { rerankReadings: { dropped: [{}] } }),
        read("rb", [], { variant: "robustez", tier: null, present: 0 }),
        read("abs", [RUT2], { kind: "abstention", tier: "abstain" }),
      ],
    },
  ];
  const report = carrierRecall(draws, list);

  it("counts each row over the draws that kept its case", () => {
    expect(report.rows.map((r) => [r.carried, r.draws])).toEqual([
      [1, 2],
      [0, 1],
    ]);
    expect(meanShare(report.rows)).toBe("1/3 (33.3 %)");
  });

  it("splits hit-rate from the robustness block, and lists the exclusion", () => {
    const [d1, d2] = report.draws;
    expect(d1).toMatchObject({
      hits: 1,
      gated: 2,
      allTargets: 1,
      robustnessHits: 1,
      robustness: 1,
      weak: ["abs"],
      medianSize: 1,
      excluded: [],
    });
    expect(d2).toMatchObject({ hits: 1, gated: 1, excluded: ["t2"] });
  });

  it("reads Jaccard on chunk ids, the step-pinned subset, and isWeak flips", () => {
    const t1 = report.cases.find((c) => c.id === "t1");
    expect(t1).toMatchObject({ tierOne: true, draws: 2, jaccard: 0.5 });
    expect(t1?.sameStepPins).toBe(false);
    expect(report.cases.find((c) => c.id === "t2")).toMatchObject({
      draws: 1,
      jaccard: null,
      sameStepPins: null,
    });
    expect(report.weakFlips).toEqual(["abs"]);
    expect(formatReport(report)).toContain(
      "step-pinned subset identical on every draw: 0/1",
    );
  });

  it("calls a probe without pins unknown, not identical (before #579)", () => {
    const bare = (id: string) => {
      const r = read(id, [RUT2], { steps: "T1-A" });
      delete r.per[CONFIG].pins;
      return r;
    };
    const old = carrierRecall(
      [
        { name: "a", reads: [bare("t1")] },
        { name: "b", reads: [bare("t1")] },
      ],
      list,
    );
    expect(old.cases[0].sameStepPins).toBeNull();
  });
});

describe("eval/runs/2026-10-12-611/carriers.json (#611's frozen list)", () => {
  const list = parseCarrierList(
    readFileSync(
      path.join(
        process.cwd(),
        "eval",
        "runs",
        "2026-10-12-611",
        "carriers.json",
      ),
      "utf8",
    ),
  );
  const dataset = parseDataset(readFileSync(DATASET_PATH, "utf8"));
  const corpus = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));

  it("names Tier 1 cases, and F1's BMC case", () => {
    for (const r of list) {
      const evalCase = dataset.find((c) => c.id === r.case);
      expect(evalCase, r.case).toBeDefined();
      if (r.case !== "ccss-cuanto-pago-base") expect(evalCase?.tier).toBe(1);
    }
  });

  it("names chunks the committed corpus holds", () => {
    for (const r of list) {
      for (const target of r.parts.flatMap((p) => p.carriers)) {
        expect(
          corpus.entries.some((entry) => chunkMatchesTarget(entry, target)),
          `${r.case}: ${target.docKey} · ${target.articulo ?? "*"}`,
        ).toBe(true);
      }
    }
  });
});
