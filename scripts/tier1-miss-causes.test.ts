import { describe, expect, it } from "vitest";
import {
  catalogueCarriers,
  causeIn,
  checkQuotes,
  classify,
  countCauses,
  lostRequirements,
  quoteCheckSql,
  renderTable,
  requirementOf,
  splitLanes,
  type Carrier,
  type Row,
  type Tagged,
} from "./tier1-miss-causes";

const carrier = (chunkId: string, quote = "texto"): Carrier => ({
  chunkId,
  docKey: "cnpt",
  articulo: "Artículo 79",
  quote,
});

const row = (
  id: string,
  chunkIds: string[],
  missing: string[] = [],
  literals: string[] = [],
): Row => ({
  id,
  chunks: chunkIds.map((chunkId) => ({
    chunkId,
    docKey: "cnpt",
    articulo: "Artículo 79",
    content: "Los sujetos pasivos  tendrán una multa\nequivalente al 50%.",
  })),
  adequacy: { missing, literals },
});

const dataset = [
  { id: "t1", tier: 1 as const, variant: "literal" as const },
  { id: "t2", tier: 2 as const },
  { id: "rb", tier: 1 as const, variant: "robustez" as const },
];

describe("requirementOf", () => {
  it("strips a failed literal's suffix and keeps the claim's own parentheses", () => {
    expect(
      requirementOf(
        "Se sanciona con el cincuenta por ciento (50 %) de un salario base. (50 % | 50%: absent)",
      ),
    ).toBe(
      "Se sanciona con el cincuenta por ciento (50 %) de un salario base.",
    );
    expect(requirementOf("Cinco años. (cinco años: present but uncited)")).toBe(
      "Cinco años.",
    );
  });

  it("leaves a judged requirement alone", () => {
    expect(requirementOf("Dónde se paga (en la sucursal).")).toBe(
      "Dónde se paga (en la sucursal).",
    );
  });
});

describe("lostRequirements", () => {
  it("reads Tier 1 only, outside the robustness block, judged and literal alike", () => {
    const rows = [
      row("t1", [], ["Un paso."], ["Una cifra. (13 %: absent)"]),
      row("t2", [], ["Tier 2."]),
      row("rb", [], ["Robustez."]),
      { ...row("t1", []), id: "unknown" },
    ];
    expect(lostRequirements(rows, dataset)).toEqual([
      { case: "t1", requirement: "Un paso." },
      { case: "t1", requirement: "Una cifra." },
    ]);
  });

  it("skips a row whose adequacy was not read", () => {
    expect(
      lostRequirements([{ id: "t1", chunks: [], adequacy: null }], dataset),
    ).toEqual([]);
  });
});

describe("splitLanes", () => {
  it("separates the misses both lanes share from each lane's own", () => {
    const a = { case: "t1", requirement: "A" };
    const b = { case: "t1", requirement: "B" };
    const c = { case: "t1", requirement: "C" };
    expect(splitLanes([a, b], [b, c])).toEqual({
      both: [b],
      onlyOne: [a],
      onlyTwo: [c],
    });
  });
});

describe("causeIn", () => {
  const tagged = (parts: Tagged["parts"]): Tagged => ({
    case: "t1",
    requirement: "R",
    parts,
  });

  it("is 1 with no carrier, 2 with carriers outside the set, 3 with one inside", () => {
    expect(causeIn(tagged([{ what: "x", carriers: [] }]), new Set())).toBe(1);
    expect(
      causeIn(
        tagged([{ what: "x", carriers: [carrier("a")] }]),
        new Set(["b"]),
      ),
    ).toBe(2);
    expect(
      causeIn(
        tagged([{ what: "x", carriers: [carrier("a"), carrier("b")] }]),
        new Set(["b"]),
      ),
    ).toBe(3);
  });

  it("takes the most upstream part", () => {
    const parts = [
      { what: "in the set", carriers: [carrier("a")] },
      { what: "outside it", carriers: [carrier("b")] },
    ];
    expect(causeIn(tagged(parts), new Set(["a"]))).toBe(2);
    expect(
      causeIn(
        tagged([...parts, { what: "nowhere", carriers: [] }]),
        new Set(["a", "b"]),
      ),
    ).toBe(1);
  });
});

describe("checkQuotes", () => {
  const tagged = (c: Carrier): Tagged[] => [
    { case: "t1", requirement: "R", parts: [{ what: "x", carriers: [c] }] },
  ];

  it("matches a quote across the chunk's whitespace", () => {
    expect(
      checkQuotes(tagged(carrier("a", "tendrán una multa equivalente")), [
        row("t1", ["a"]),
      ]),
    ).toEqual({ failures: [], unchecked: [] });
  });

  it("fails a quote the chunk does not carry, or a mislabelled chunk", () => {
    expect(
      checkQuotes(tagged(carrier("a", "del 25%")), [row("t1", ["a"])]).failures,
    ).toHaveLength(1);
    expect(
      checkQuotes(
        tagged({ ...carrier("a", "multa"), articulo: "Artículo 78" }),
        [row("t1", ["a"])],
      ).failures,
    ).toHaveLength(1);
  });

  it("returns a carrier no row carries as unchecked", () => {
    const outside = carrier("z");
    expect(checkQuotes(tagged(outside), [row("t1", ["a"])])).toEqual({
      failures: [],
      unchecked: [outside],
    });
  });
});

describe("quoteCheckSql", () => {
  it("escapes quotes and reads chunks only", () => {
    const sql = quoteCheckSql([carrier("a", "la «D-104»  de l'año")]);
    expect(sql).toContain("('a', 'la «D-104» de l''año')");
    expect(sql.trimStart().toLowerCase().startsWith("select")).toBe(true);
    expect(sql).not.toMatch(/\b(insert|update|delete|drop|alter)\b/i);
  });
});

describe("catalogueCarriers", () => {
  const catalogue = {
    families: {
      "T1-X": { cases: ["t1"], reaches: ["cnpt · Artículo 79", "cabys-dev"] },
      "T1-Y": { cases: ["other"], reaches: ["cnpt · Artículo 88"] },
    },
  };
  const parts = (c: Carrier) => [{ what: "x", carriers: [c] }];

  it("matches the case's own family by `docKey · articulo`, or docKey alone", () => {
    expect(catalogueCarriers("t1", parts(carrier("a")), catalogue)).toEqual([
      carrier("a"),
    ]);
    const whole = { ...carrier("a"), docKey: "cabys-dev", articulo: null };
    expect(catalogueCarriers("t1", parts(whole), catalogue)).toEqual([whole]);
  });

  it("does not count another family's reach", () => {
    expect(
      catalogueCarriers(
        "t1",
        parts({ ...carrier("a"), articulo: "Artículo 88" }),
        catalogue,
      ),
    ).toEqual([]);
  });
});

describe("classify: the catalogue and expected-target flags", () => {
  it("read only the parts that missed an answer set", () => {
    const catalogue = {
      families: { "T1-X": { cases: ["t1"], reaches: ["cnpt · Artículo 79"] } },
    };
    const tagged: Tagged[] = [
      {
        case: "t1",
        requirement: "R",
        parts: [
          { what: "in both sets", carriers: [carrier("in")] },
          {
            what: "in neither",
            carriers: [{ ...carrier("out"), articulo: "Artículo 2" }],
          },
        ],
      },
    ];
    const { classified } = classify(
      [{ case: "t1", requirement: "R" }],
      tagged,
      [row("t1", ["in"])],
      [row("t1", ["in"])],
      catalogue,
      new Map([["t1", [{ docKey: "cnpt", articulo: "Artículo 2" }]]]),
    );
    expect(classified[0]).toMatchObject({
      lanes: [2, 2],
      sentenceFinds: false,
      entersSet: [false, false],
      expectedTarget: true,
    });
  });

  it("splits a sentence finding the carrier from the carrier entering each set", () => {
    const catalogue = {
      families: { "T1-X": { cases: ["t1"], reaches: ["cnpt · Artículo 79"] } },
    };
    const tagged: Tagged[] = [
      {
        case: "t1",
        requirement: "R",
        parts: [
          { what: "found, in lane 2 only", carriers: [carrier("found")] },
          {
            what: "not found",
            carriers: [{ ...carrier("other"), articulo: "Artículo 2" }],
          },
        ],
      },
    ];
    const read = (one: string[], two: string[]) =>
      classify(
        [{ case: "t1", requirement: "R" }],
        tagged,
        [row("t1", one)],
        [row("t1", two)],
        catalogue,
        new Map(),
      ).classified[0];
    expect(read([], ["found"])).toMatchObject({
      lanes: [2, 2],
      sentenceFinds: true,
      entersSet: [false, true],
    });
    const outside = read([], []);
    expect(outside).toMatchObject({
      sentenceFinds: true,
      entersSet: [false, false],
    });
    expect(countCauses([outside])).toMatchObject({
      sentenceFindsCause2: 1,
      foundOutsideCause2: 1,
    });
    expect(renderTable([outside])).toContain("| **2** | yes | no | no |");
    expect(renderTable([read(["found"], [])])).toContain(
      "| **2** | yes | yes / no | no |",
    );
  });
});

describe("classify: the carriers file's order", () => {
  const tag = (requirement: string): Tagged => ({
    case: "t1",
    requirement,
    parts: [{ what: "x", carriers: [carrier("a")] }],
  });
  const both = [
    { case: "t1", requirement: "A" },
    { case: "t1", requirement: "B" },
  ];
  const errorsFor = (tagged: Tagged[]) =>
    classify(both, tagged, [], [], { families: {} }, new Map()).errors;

  it("passes when the file lists the rows in the table's order", () => {
    expect(errorsFor([tag("A"), tag("B")])).toEqual([]);
  });

  it("fails naming the first row where the file and the table differ", () => {
    expect(errorsFor([tag("B"), tag("A")])).toEqual([
      "carriers file out of the table's order at row 1: the file has t1: B, the table t1: A",
    ]);
  });
});

describe("classify and countCauses", () => {
  const catalogue = { families: {} };
  const both = [
    { case: "t1", requirement: "R2" },
    { case: "t1", requirement: "Rsplit" },
    { case: "t1", requirement: "Untagged" },
  ];
  const tags: Tagged[] = [
    {
      case: "t1",
      requirement: "R2",
      parts: [{ what: "x", carriers: [carrier("out")] }],
    },
    {
      case: "t1",
      requirement: "Rsplit",
      parts: [{ what: "x", carriers: [carrier("b")] }],
      uncertain: true,
    },
    {
      case: "t1",
      requirement: "Stale",
      parts: [{ what: "x", carriers: [] }],
    },
  ];

  it("takes each lane's cause from its own answer set and names the gaps", () => {
    const { classified, errors } = classify(
      both,
      tags,
      [row("t1", ["a"])],
      [row("t1", ["b"])],
      catalogue,
      new Map(),
    );
    expect(classified.map((c) => c.lanes)).toEqual([
      [2, 2],
      [2, 3],
    ]);
    expect(errors).toEqual([
      "tagged but not missed in both lanes: t1: Stale",
      "missed in both lanes, not tagged: t1: Untagged",
    ]);
    expect(countCauses(classified)).toEqual({
      1: 0,
      2: 1,
      3: 0,
      split: 1,
      uncertain: 1,
      sentenceFindsCause2: 0,
      foundOutsideCause2: 0,
      expectedCause2: 0,
    });
  });
});
