import { describe, expect, it } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  chunkCitations,
  citationMarkers,
  createCitationTracker,
  dropUnbackedMarkers,
  renumberCitationMarkers,
} from "./citations";

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
    fetchedAt: "2026-08-06T15:04:05Z",
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

describe("citationMarkers", () => {
  it("reads every marker in order, duplicates and all", () => {
    expect(citationMarkers("La tarifa es 13% [2]. Aplica [1] y [2].")).toEqual([
      2, 1, 2,
    ]);
  });

  it("reads a run of adjacent markers as separate citations", () => {
    expect(citationMarkers("…están exentos [6][8].")).toEqual([6, 8]);
  });

  it("leaves brackets that are not bare integers alone", () => {
    // Legal prose carries brackets of its own; the same rule `MARKER_RUN`
    // applies when stripping, so both sides agree on what a citation is.
    expect(citationMarkers("Ver el [nota], el [12x] y el [ 3 ].")).toEqual([]);
  });

  it("finds nothing in text with no markers", () => {
    expect(citationMarkers("La tarifa es del 13%.")).toEqual([]);
  });
});

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

describe("createCitationTracker ordinals", () => {
  it("maps each chunk index to its seal's 1-based position", () => {
    const tracker = createCitationTracker(CHUNKS);
    tracker.append("Primero [3]. Después [1].");
    // Seals are [ccss-reglamento, ley-9635]; chunks 1 and 2 share an
    // artículo, so both resolve to the same seal.
    expect(tracker.ordinals()).toEqual([2, 2, 1]);
  });

  it("reports 0 for chunks no marker has cited yet", () => {
    const tracker = createCitationTracker(CHUNKS);
    expect(tracker.ordinals()).toEqual([0, 0, 0]);
    tracker.append("Solo esto [1].");
    expect(tracker.ordinals()).toEqual([1, 1, 0]);
  });
});

describe("dropUnbackedMarkers", () => {
  it("keeps the markers a seal backs and deletes the rest", () => {
    expect(dropUnbackedMarkers("Uno[1], dos[2] y tres[3].", 2)).toBe(
      "Uno[1], dos[2] y tres.",
    );
    expect(dropUnbackedMarkers("Uno[1].", 0)).toBe("Uno.");
  });

  it("leaves an already-clean answer exactly as it is", () => {
    const text = "- Punto uno[1]\n- Punto dos[2]";
    expect(dropUnbackedMarkers(text, 2)).toBe(text);
  });
});

describe("renumberCitationMarkers", () => {
  const ORDINALS = [2, 2, 1];

  it("rewrites a marker to its seal ordinal, eating the space before it", () => {
    expect(renumberCitationMarkers("La tarifa es del 13% [3].", ORDINALS)).toBe(
      "La tarifa es del 13%[1].",
    );
  });

  it("collapses a run that resolves to one seal", () => {
    expect(renumberCitationMarkers("están exentos [1][2].", ORDINALS)).toBe(
      "están exentos[2].",
    );
  });

  it("keeps a run of distinct seals in order", () => {
    expect(renumberCitationMarkers("Ambas cosas [3][1].", ORDINALS)).toBe(
      "Ambas cosas[1][2].",
    );
  });

  // Deleting rather than surfacing is deliberate, and safe only under the
  // documented contract — the caller validated the answer first (#131, #170).
  it("drops markers with no seal, along with the space before them", () => {
    expect(
      renumberCitationMarkers("Aplica el IVA [9] y la renta [3].", ORDINALS),
    ).toBe("Aplica el IVA y la renta[1].");
    expect(renumberCitationMarkers("La tarifa es del 13% [1].", [])).toBe(
      "La tarifa es del 13%.",
    );
  });

  it("leaves brackets that are not bare integers intact", () => {
    const text = "Ver [nota] y [12x] y [Artículo 4] y [].";
    expect(renumberCitationMarkers(text, ORDINALS)).toBe(text);
  });

  it("is idempotent under the identity map", () => {
    const once = renumberCitationMarkers("Uno [3] y dos [1].", ORDINALS);
    expect(dropUnbackedMarkers(once, 2)).toBe(once);
  });

  it("leaves marker-free prose untouched", () => {
    const text = "No encuentro base oficial en los documentos que manejo.";
    expect(renumberCitationMarkers(text, ORDINALS)).toBe(text);
  });

  it("does not swallow newlines around a marker", () => {
    expect(
      renumberCitationMarkers("- Punto uno [3]\n- Punto dos [1]", ORDINALS),
    ).toBe("- Punto uno[1]\n- Punto dos[2]");
  });

  it("hides a half-typed marker while the answer is still streaming", () => {
    expect(
      renumberCitationMarkers("La tarifa es del 13% [1", ORDINALS, {
        streaming: true,
      }),
    ).toBe("La tarifa es del 13%");
    expect(renumberCitationMarkers("La tarifa es del 13% [1", ORDINALS)).toBe(
      "La tarifa es del 13% [1",
    );
  });
});
