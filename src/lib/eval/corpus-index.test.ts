import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildCorpusIndex,
  CORPUS_INDEX_PATH,
  parseCorpusIndex,
  serializeCorpusIndex,
} from "./corpus-index";

const chunk = (
  docKey: string,
  articulo: string | null,
  path: string[] = [],
) => ({
  docKey,
  articulo,
  path,
});

describe("buildCorpusIndex", () => {
  it("keeps one entry per distinct (docKey, articulo, path) triple", () => {
    const index = buildCorpusIndex(
      [
        chunk("ley-iva", "Artículo 8"),
        chunk("ley-iva", "Artículo 8"),
        chunk("ley-iva", "Artículo 9"),
      ],
      "2026-01-01T00:00:00.000Z",
    );
    expect(index.entries).toEqual([
      chunk("ley-iva", "Artículo 8"),
      chunk("ley-iva", "Artículo 9"),
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
      [chunk("ley-iva", "Artículo 8"), chunk("ley-iva", "Artículo 8")],
      "2026-01-01T00:00:00.000Z",
    );
    expect(index.chunkCount).toBe(2);
    expect(index.entries).toHaveLength(1);
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
  ])("rejects %s", (json, message) => {
    expect(() => parseCorpusIndex(json)).toThrow(message);
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
