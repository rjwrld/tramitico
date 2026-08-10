import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { chunkCitations, createCitationTracker } from "./citations";

function chunk(overrides: Partial<RetrievedChunk> = {}): RetrievedChunk {
  return {
    chunkId: "c1",
    docKey: "ley-9635",
    docTitle: "Ley 9635",
    norma: "Ley 9635",
    articulo: "Artículo 4",
    path: [],
    part: 0,
    content: "contenido",
    source: { kind: "sinalevi", idFichaNorma: 12345 },
    score: 0.03,
    vectorRank: 1,
    lexicalRank: 1,
    ...overrides,
  };
}

const CHUNKS = [
  chunk(),
  chunk({ chunkId: "c2", part: 1 }), // same artículo, different part
  chunk({
    chunkId: "c3",
    docKey: "ccss-reglamento",
    docTitle: "Reglamento CCSS",
    articulo: "Artículo 10",
  }),
];

describe("chunkCitations", () => {
  it("maps each chunk index to a citation with a resolved url", () => {
    const citations = chunkCitations(CHUNKS);
    expect(citations).toHaveLength(3);
    expect(citations[0].docKey).toBe("ley-9635");
    expect(citations[0].url).toContain("sinalevi.go.cr");
    expect(citations[2].docKey).toBe("ccss-reglamento");
  });
});

describe("createCitationTracker", () => {
  it("emits citations in order of first use, deduped", () => {
    const tracker = createCitationTracker(CHUNKS);
    tracker.append("La tarifa es 13% [3]. Aplica el IVA [1] y también [1].");
    expect(tracker.used().map((c) => c.docKey)).toEqual([
      "ccss-reglamento",
      "ley-9635",
    ]);
  });

  it("collapses two chunks of the same artículo into one citation", () => {
    const tracker = createCitationTracker(CHUNKS);
    tracker.append("Una cosa [1] y otra [2].");
    expect(tracker.used()).toHaveLength(1);
    expect(tracker.used()[0].articulo).toBe("Artículo 4");
  });

  it("handles markers split across streamed deltas", () => {
    const tracker = createCitationTracker(CHUNKS);
    expect(tracker.append("Según la ley [")).toHaveLength(0);
    expect(tracker.append("3")).toHaveLength(0);
    const added = tracker.append("] aplica.");
    expect(added.map((c) => c.docKey)).toEqual(["ccss-reglamento"]);
  });

  it("returns only newly used citations from append", () => {
    const tracker = createCitationTracker(CHUNKS);
    const first = tracker.append("Uno [1].");
    const second = tracker.append("Otra vez [1] y nuevo [3].");
    expect(first).toHaveLength(1);
    expect(second.map((c) => c.docKey)).toEqual(["ccss-reglamento"]);
  });

  // #73 paces the answer stream with `smoothStream({ chunking: "word" })`, so
  // the tracker is fed one word per delta instead of the provider's bursts.
  // Word boundaries keep "[3]" whole (verified against smoothStream), but the
  // tracker must be indifferent to delivery shape either way.
  describe("delivery shape", () => {
    const TEXT =
      "La tarifa es 13% [3]. Aplica a servicios [1] y también [2] en el mismo [3].";

    function trackedDocKeys(deltas: readonly string[]): string[] {
      const tracker = createCitationTracker(CHUNKS);
      const streamed = deltas.flatMap((delta) => tracker.append(delta));
      // Every citation is announced exactly once, as it is first used.
      expect(streamed).toEqual(tracker.used());
      return tracker.used().map((c) => c.docKey);
    }

    const asBlob = () => trackedDocKeys([TEXT]);

    it("emits the same citations for word-chunked deltas as for one blob", () => {
      const words = TEXT.split(" ").map((word, i, all) =>
        i === all.length - 1 ? word : `${word} `,
      );
      expect(words.join("")).toBe(TEXT);
      expect(trackedDocKeys(words)).toEqual(asBlob());
    });

    it("emits the same citations when a marker splits across three deltas", () => {
      const [before, after] = TEXT.split("[3]. Aplica");
      expect(trackedDocKeys([`${before}[`, "3", `]. Aplica${after}`])).toEqual(
        asBlob(),
      );
    });

    it("emits the same citations one character at a time", () => {
      expect(trackedDocKeys([...TEXT])).toEqual(asBlob());
    });
  });

  it("ignores out-of-range and non-citation brackets", () => {
    const tracker = createCitationTracker(CHUNKS);
    tracker.append("Ver [9] o [0] o [nota] o [12x].");
    expect(tracker.used()).toHaveLength(0);
  });
});
