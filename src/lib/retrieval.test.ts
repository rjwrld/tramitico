import { describe, expect, it } from "vitest";
import {
  DEFAULT_MATCH_COUNT,
  RRF_K,
  citationUrl,
  fuseRrf,
  isCorroborated,
  retrieve,
  rrfScore,
  toCitation,
  type RetrievalRpcClient,
  type RetrievedChunk,
  type SearchChunksRow,
} from "./retrieval";
import type { Embedder } from "./ingestion/embedder";

describe("rrfScore", () => {
  it("is 1/(k + rank)", () => {
    expect(rrfScore(1)).toBeCloseTo(1 / (RRF_K + 1), 12);
    expect(rrfScore(20)).toBeCloseTo(1 / (RRF_K + 20), 12);
  });

  it("decreases monotonically with rank", () => {
    expect(rrfScore(1)).toBeGreaterThan(rrfScore(2));
    expect(rrfScore(2)).toBeGreaterThan(rrfScore(19));
  });

  it("rejects ranks below 1", () => {
    expect(() => rrfScore(0)).toThrow(/rank/i);
  });
});

describe("fuseRrf", () => {
  it("sums the contribution of every leg the id appears in", () => {
    const fused = fuseRrf([["a", "b"], ["b"]]);
    expect(fused).toEqual([
      { id: "b", score: rrfScore(2) + rrfScore(1) },
      { id: "a", score: rrfScore(1) },
    ]);
  });

  it("beats either leg alone: agreed-on middle beats a leader only one leg saw", () => {
    const vector = ["v1", "v2", "shared"];
    const lexical = ["l1", "l2", "shared"];
    const fused = fuseRrf([vector, lexical]);
    // "shared" is 3rd in both legs, yet fusion promotes it above both leaders.
    expect(fused[0].id).toBe("shared");
    expect(fused.map((f) => f.id).indexOf("v1")).toBeGreaterThan(0);
    expect(fused.map((f) => f.id).indexOf("l1")).toBeGreaterThan(0);
  });

  it("keeps ids only one leg produced", () => {
    expect(
      fuseRrf([["a"], ["b"]])
        .map((f) => f.id)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  it("breaks score ties by id so the order is deterministic", () => {
    expect(fuseRrf([["b"], ["a"]]).map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("honours a custom k", () => {
    expect(fuseRrf([["a"]], 0)[0].score).toBeCloseTo(1, 12);
  });

  it("scales a weighted entry's contribution, mirroring coverage scaling", () => {
    // A fully-covered chunk at rank 2 beats a 1/8-covered chunk at rank 1 —
    // the property that collapses the OR-fallback flood (#51).
    const fused = fuseRrf([
      [
        { id: "flood", weight: 1 / 8 },
        { id: "covered", weight: 1 },
      ],
    ]);
    expect(fused[0]).toEqual({ id: "covered", score: rrfScore(2) });
    expect(fused[1]).toEqual({ id: "flood", score: rrfScore(1) / 8 });
  });

  it("treats a bare id and weight 1 identically", () => {
    expect(fuseRrf([[{ id: "a", weight: 1 }]])).toEqual(fuseRrf([["a"]]));
  });

  it("returns nothing for empty legs", () => {
    expect(fuseRrf([[], []])).toEqual([]);
  });
});

describe("citationUrl", () => {
  it("derives a SINALEVI viewer link from a ficha id", () => {
    expect(
      citationUrl({
        kind: "sinalevi",
        idFichaNorma: 99349,
        idVersionNorma: 135825,
      }),
    ).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=99349&param2=&param3=1&param4=",
    );
  });

  it("passes through the url of url-backed sources", () => {
    expect(
      citationUrl({
        kind: "hacienda-pdf",
        url: "https://www.hacienda.go.cr/docs/TramosRenta2026.pdf",
      }),
    ).toBe("https://www.hacienda.go.cr/docs/TramosRenta2026.pdf");
    expect(citationUrl({ kind: "url", url: "https://example.cr/a.pdf" })).toBe(
      "https://example.cr/a.pdf",
    );
  });

  it("falls back to a catalog link when that is the only address", () => {
    expect(
      citationUrl({ kind: "cabys", catalog: "https://bccr.fi.cr/x" }),
    ).toBe("https://bccr.fi.cr/x");
  });

  it("returns null when the source carries no address", () => {
    expect(citationUrl({ kind: "unresolved" })).toBeNull();
    expect(citationUrl({ kind: "sinalevi" })).toBeNull();
    expect(citationUrl(null)).toBeNull();
    expect(citationUrl(undefined)).toBeNull();
  });

  it("ignores non-http addresses", () => {
    expect(citationUrl({ kind: "url", url: "javascript:alert(1)" })).toBeNull();
  });
});

const ROW: SearchChunksRow = {
  chunk_id: "11111111-1111-1111-1111-111111111111",
  doc_key: "ley-10363",
  doc_title: "Ley del Trabajador Independiente",
  norma: "Ley 10363",
  articulo: "ARTÍCULO 2",
  path: ["CAPÍTULO I"],
  part: 0,
  content: "[Ley del Trabajador Independiente > ARTÍCULO 2] La prescripción…",
  source: { kind: "sinalevi", idFichaNorma: 99349, idVersionNorma: 135825 },
  score: rrfScore(1) + rrfScore(1),
  vector_rank: 1,
  lexical_rank: 1,
};

const CHUNK: RetrievedChunk = {
  chunkId: ROW.chunk_id,
  docKey: ROW.doc_key,
  docTitle: ROW.doc_title,
  norma: ROW.norma,
  articulo: ROW.articulo,
  path: ROW.path,
  part: ROW.part,
  content: ROW.content,
  source: ROW.source,
  score: ROW.score,
  vectorRank: ROW.vector_rank,
  lexicalRank: ROW.lexical_rank,
};

describe("toCitation", () => {
  it("maps a chunk to its document-level citation", () => {
    expect(toCitation(CHUNK)).toEqual({
      docKey: "ley-10363",
      docTitle: "Ley del Trabajador Independiente",
      norma: "Ley 10363",
      articulo: "ARTÍCULO 2",
      url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=99349&param2=&param3=1&param4=",
    });
  });
});

function fakeEmbedder(dimensions = 3): Embedder {
  return {
    provider: "fake",
    dimensions,
    embed: async (texts) =>
      texts.map(() => new Array<number>(dimensions).fill(0.5)),
  };
}

function fakeClient(
  rows: SearchChunksRow[],
  onArgs?: (args: Record<string, unknown>) => void,
): RetrievalRpcClient {
  return {
    rpc: async (fn, args) => {
      expect(fn).toBe("search_chunks");
      onArgs?.({ ...args });
      return { data: rows, error: null };
    },
  };
}

describe("retrieve", () => {
  it("passes the embedded query and match count to the RPC", async () => {
    let seen: Record<string, unknown> | undefined;
    await retrieve("¿me cobran retroactivo?", {
      client: fakeClient([ROW], (args) => {
        seen = args;
      }),
      embedder: fakeEmbedder(),
      matchCount: 5,
    });
    expect(seen).toEqual({
      query_text: "¿me cobran retroactivo?",
      query_embedding: "[0.5,0.5,0.5]",
      match_count: 5,
    });
  });

  it("defaults to the spec's match count", async () => {
    let seen: Record<string, unknown> | undefined;
    await retrieve("iva", {
      client: fakeClient([], (args) => {
        seen = args;
      }),
      embedder: fakeEmbedder(),
    });
    expect(seen?.match_count).toBe(DEFAULT_MATCH_COUNT);
    expect(DEFAULT_MATCH_COUNT).toBe(8);
  });

  it("maps rows to camel-cased chunks and deduplicated citations", async () => {
    const secondPart: SearchChunksRow = {
      ...ROW,
      chunk_id: "22222222-2222-2222-2222-222222222222",
      part: 1,
      score: rrfScore(2),
    };
    const other: SearchChunksRow = {
      ...ROW,
      chunk_id: "33333333-3333-3333-3333-333333333333",
      doc_key: "tramos-renta-2026",
      doc_title: "Tramos del Impuesto sobre la Renta 2026",
      norma: "Decreto Ejecutivo 45333-H",
      articulo: null,
      path: [],
      source: {
        kind: "hacienda-pdf",
        url: "https://www.hacienda.go.cr/docs/TramosRenta2026.pdf",
      },
      score: rrfScore(3),
    };
    const result = await retrieve("prescripción", {
      client: fakeClient([ROW, secondPart, other]),
      embedder: fakeEmbedder(),
    });

    expect(result.chunks).toHaveLength(3);
    expect(result.chunks[0]).toMatchObject({
      chunkId: ROW.chunk_id,
      docKey: "ley-10363",
      docTitle: "Ley del Trabajador Independiente",
      articulo: "ARTÍCULO 2",
      path: ["CAPÍTULO I"],
      part: 0,
    });
    // Both parts of ARTÍCULO 2 collapse into one citation.
    expect(result.citations.map((c) => c.docKey)).toEqual([
      "ley-10363",
      "tramos-renta-2026",
    ]);
  });

  it("exposes the top score and flags weak retrieval for #21", async () => {
    const strong = await retrieve("iva", {
      client: fakeClient([{ ...ROW, score: rrfScore(1) + rrfScore(1) }]),
      embedder: fakeEmbedder(),
    });
    expect(strong.topScore).toBeCloseTo(rrfScore(1) + rrfScore(1), 12);
    expect(strong.isWeak).toBe(false);

    // Single-leg hits only — nothing corroborated, however well they score.
    const weak = await retrieve("iva", {
      client: fakeClient([
        { ...ROW, score: rrfScore(1), lexical_rank: null },
        {
          ...ROW,
          chunk_id: "22222222-2222-2222-2222-222222222222",
          score: rrfScore(1),
          vector_rank: null,
          lexical_rank: 1,
        },
      ]),
      embedder: fakeEmbedder(),
    });
    expect(weak.isWeak).toBe(true);
  });

  it("judges corroboration by leg membership, not score", () => {
    expect(isCorroborated({ vectorRank: 50, lexicalRank: 50 })).toBe(true);
    expect(isCorroborated({ vectorRank: 1, lexicalRank: null })).toBe(false);
    expect(isCorroborated({ vectorRank: null, lexicalRank: 1 })).toBe(false);
  });

  it("treats an empty result as weak with a zero top score", async () => {
    const result = await retrieve("algo que no existe", {
      client: fakeClient([]),
      embedder: fakeEmbedder(),
    });
    expect(result.chunks).toEqual([]);
    expect(result.citations).toEqual([]);
    expect(result.topScore).toBe(0);
    expect(result.isWeak).toBe(true);
  });

  it("short-circuits a blank query without touching the database", async () => {
    const result = await retrieve("   ", {
      client: {
        rpc: async () => {
          throw new Error("must not be called");
        },
      },
      embedder: fakeEmbedder(),
    });
    expect(result.chunks).toEqual([]);
    expect(result.isWeak).toBe(true);
  });

  it("surfaces RPC errors with the query in the message", async () => {
    const client: RetrievalRpcClient = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    };
    await expect(
      retrieve("iva", { client, embedder: fakeEmbedder() }),
    ).rejects.toThrow(/search_chunks/);
    await expect(
      retrieve("iva", { client, embedder: fakeEmbedder() }),
    ).rejects.toThrow(/boom/);
  });
});
