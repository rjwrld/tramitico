import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildCorpusIndex,
  collidingEntries,
  CORPUS_INDEX_PATH,
  describeEntry,
  formatCorpusIndex,
  parseCorpusIndex,
  sameCoverage,
  serializeCorpusIndex,
} from "./corpus-index";

const chunk = (
  docKey: string,
  articulo: string | null,
  path: string[] = [],
  part = 0,
) => ({
  docKey,
  articulo,
  path,
  part,
});

const entry = (
  docKey: string,
  articulo: string | null,
  path: string[] = [],
  counts: { chunks: number; parts: number } = { chunks: 1, parts: 1 },
) => ({ docKey, articulo, path, ...counts });

describe("buildCorpusIndex", () => {
  it("keeps one entry per distinct (docKey, articulo, path) triple", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-iva", "Artículo 8", [], 0),
        chunk("ley-iva", "Artículo 8", [], 1),
        chunk("ley-iva", "Artículo 9"),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(index.entries).toEqual([
      entry("ley-iva", "Artículo 8", [], { chunks: 2, parts: 2 }),
      entry("ley-iva", "Artículo 9"),
    ]);
  });

  it("treats one artículo label under two paths as two entries", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-9635", "Artículo 15", ["TÍTULO I"]),
        chunk("ley-9635", "Artículo 15", ["TÍTULO II"]),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(index.entries).toHaveLength(2);
  });

  it("records the row count, not the entry count", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-iva", "Artículo 8", [], 0),
        chunk("ley-iva", "Artículo 8", [], 1),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(index.chunkCount).toBe(2);
    expect(index.entries).toHaveLength(1);
  });

  it("counts chunks and distinct parts per entry", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-renta", "ARTICULO 66", [], 0),
        chunk("ley-renta", "ARTICULO 66", [], 0),
        chunk("ley-renta", "ARTICULO 66", [], 1),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(index.entries).toEqual([
      entry("ley-renta", "ARTICULO 66", [], { chunks: 3, parts: 2 }),
    ]);
  });

  it("orders entries so an unchanged corpus re-dumps byte-identically", () => {
    const at = "2026-01-01T00:00:00.000Z";
    const forward = buildCorpusIndex(
      [chunk("b-doc", "Artículo 2"), chunk("a-doc", "Artículo 1")],
      at,
    );
    const reversed = buildCorpusIndex(
      [chunk("a-doc", "Artículo 1"), chunk("b-doc", "Artículo 2")],
      at,
    );
    expect(serializeCorpusIndex(forward)).toBe(serializeCorpusIndex(reversed));
    expect(forward.entries[0].docKey).toBe("a-doc");
  });
});

describe("parseCorpusIndex", () => {
  const valid = serializeCorpusIndex(
    buildCorpusIndex(
      [chunk("ley-iva", "Artículo 8"), chunk("cabys-dev", null)],
      "2026-01-01T00:00:00.000Z",
    ),
  );

  it("round-trips a serialized index", () => {
    expect(parseCorpusIndex(valid)).toEqual(
      buildCorpusIndex(
        [chunk("cabys-dev", null), chunk("ley-iva", "Artículo 8")],
        "2026-01-01T00:00:00.000Z",
      ),
    );
  });

  it("ends the file with a newline, as Prettier writes JSON", () => {
    expect(valid.endsWith("}\n")).toBe(true);
  });

  it.each([
    ["not json", "malformed JSON"],
    ["{}", "missing generatedAt"],
    ['{"generatedAt":"x"}', "missing chunkCount"],
    ['{"generatedAt":"x","chunkCount":0,"entries":[]}', "missing entries"],
    [
      '{"generatedAt":"x","chunkCount":1,"entries":[{"articulo":null,"path":[]}]}',
      "entry missing docKey",
    ],
    [
      '{"generatedAt":"x","chunkCount":1,"entries":[{"docKey":"d","path":[]}]}',
      "missing articulo",
    ],
    [
      '{"generatedAt":"x","chunkCount":1,"entries":[{"docKey":"d","articulo":null,"path":[1]}]}',
      "non-string path",
    ],
    [
      '{"generatedAt":"x","chunkCount":1,"entries":[{"docKey":"d","articulo":null,"path":[]}]}',
      "entry missing chunks",
    ],
    [
      '{"generatedAt":"x","chunkCount":1,"entries":[{"docKey":"d","articulo":null,"path":[],"chunks":1}]}',
      "entry missing parts",
    ],
  ])("rejects %s", (json, message) => {
    expect(() => parseCorpusIndex(json)).toThrow(message);
  });
});

describe("sameCoverage", () => {
  const at = "2026-09-25T00:00:00.000Z";
  const base = buildCorpusIndex([chunk("a-doc", "Artículo 1")], at);

  it("ignores when the dump was taken", () => {
    const later = buildCorpusIndex(
      [chunk("a-doc", "Artículo 1")],
      "2026-10-01T00:00:00.000Z",
    );
    expect(sameCoverage(base, later)).toBe(true);
  });

  it("sees a new target, a lost one, and a changed chunk count", () => {
    const added = buildCorpusIndex(
      [chunk("a-doc", "Artículo 1"), chunk("a-doc", "Artículo 2")],
      at,
    );
    const split = buildCorpusIndex(
      [chunk("a-doc", "Artículo 1"), chunk("a-doc", "Artículo 1", [], 1)],
      at,
    );
    expect(sameCoverage(base, added)).toBe(false);
    expect(sameCoverage(added, base)).toBe(false);
    expect(sameCoverage(base, split)).toBe(false);
  });
});

describe("formatCorpusIndex", () => {
  it("reproduces the committed file byte for byte, so a re-dump passes format:check", async () => {
    const onDisk = readFileSync(CORPUS_INDEX_PATH, "utf8");
    expect(await formatCorpusIndex(parseCorpusIndex(onDisk))).toBe(onDisk);
  });
});

describe("the committed document set (#256)", () => {
  const committed = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));
  const docKeys = new Set(committed.entries.map((entry) => entry.docKey));

  it("has no target for the retired Regla Fiscal or port-services entries", () => {
    expect(docKeys.has("reglamento-titulo-iv-9635")).toBe(false);
    expect(docKeys.has("dgt-export-servicios")).toBe(false);
  });

  it("keeps the two excerpted documents", () => {
    expect(docKeys.has("ccss-bmc")).toBe(true);
    expect(docKeys.has("disposiciones-v44")).toBe(true);
  });
});

describe("chunk citation uniqueness (#274)", () => {
  it("flags a triple whose chunks outnumber its parts", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-renta", "Artículo 31"),
        chunk("ley-renta", "Artículo 31"),
        chunk("ley-renta", "Artículo 32"),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(collidingEntries(index).map(describeEntry)).toEqual([
      "ley-renta · Artículo 31",
    ]);
  });

  it("does not flag one long artículo split into parts", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-renta", "Artículo 31", [], 0),
        chunk("ley-renta", "Artículo 31", [], 1),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(collidingEntries(index)).toEqual([]);
  });

  // The invariant the corpus must hold: a citation identifies one artículo.
  // Before #274 nine keys in the shipped corpus were carried by two to six
  // distinct artículos each — quáter, quinquies and 66-B labelled as their
  // base número — and no eval could see it, because groundedness and hit-rate
  // both read the same wrong label.
  it("holds over the committed corpus", () => {
    const committed = parseCorpusIndex(readFileSync(CORPUS_INDEX_PATH, "utf8"));
    const collisions = collidingEntries(committed);
    expect(
      collisions.map(describeEntry),
      "chunks sharing one (docKey, articulo, path, part) citation",
    ).toEqual([]);
  });
});
