import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../src/lib/retrieval";
import { answerSetEntry } from "./answer-set-probe";

const chunk = (
  chunkId: string,
  docKey: string,
  articulo: string | null,
  part = 0,
): RetrievedChunk => ({
  chunkId,
  docKey,
  docTitle: docKey,
  norma: null,
  articulo,
  path: [],
  part,
  content: "texto",
  source: { url: "https://example.org", kind: "html" },
  fetchedAt: null,
  score: 0,
  vectorRank: null,
  lexicalRank: null,
});

describe("answerSetEntry", () => {
  it("names each set entry by chunk id, place for place, where two share a label (#593)", () => {
    const chunks = [
      chunk("id-a", "tribu-cr-faq", "Declaraciones del RUT · 31"),
      chunk("id-b", "cnpt", "Artículo 79"),
      chunk("id-c", "tribu-cr-faq", "Declaraciones del RUT · 31"),
    ];
    const entry = answerSetEntry(
      [{ docKey: "cnpt", articulo: "Artículo 79" }, { docKey: "ley-iva" }],
      chunks,
      2,
      new Map([["id-c", "step" as const]]),
    );
    expect(entry.set).toEqual([
      "tribu-cr-faq·Declaraciones del RUT · 31·#0",
      "cnpt·Artículo 79·#0",
      "tribu-cr-faq·Declaraciones del RUT · 31·#0",
    ]);
    expect(entry.chunkIds).toEqual(["id-a", "id-b", "id-c"]);
    expect(entry.pinned).toEqual([
      "tribu-cr-faq·Declaraciones del RUT · 31·#0",
    ]);
    expect(entry.pins).toEqual({
      "tribu-cr-faq·Declaraciones del RUT · 31·#0": "step",
    });
    expect(entry.present).toBe(1);
    expect(entry.missing).toEqual(["ley-iva/*"]);
    expect(entry.size).toBe(3);
  });

  it("records an empty set, every target missing, for weak retrieval", () => {
    expect(answerSetEntry([{ docKey: "cnpt" }], [], 0, new Map())).toEqual({
      present: 0,
      missing: ["cnpt/*"],
      figures: [],
      size: 0,
      pinned: [],
      set: [],
      chunkIds: [],
      pins: {},
    });
  });
});
