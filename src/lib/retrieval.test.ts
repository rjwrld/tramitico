import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MATCH_COUNT,
  RRF_K,
  citationUrl,
  fuseRrf,
  isCitation,
  isCorroborated,
  parseCitations,
  retrieve,
  rrfScore,
  SearchChunksError,
  toCitation,
  type Citation,
  type RetrievalRpcClient,
  type RetrievedChunk,
  type SearchChunksRow,
} from "./retrieval";
import type { Embedder } from "./ingestion/embedder";
import { describeError } from "./log-redaction";
import {
  degradedReason,
  degradedRetrievals,
  resetDegradedRetrievals,
} from "./retrieval-degraded";

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

describe("citationUrl deep links (#134)", () => {
  const sinalevi = {
    kind: "sinalevi",
    idFichaNorma: 98767,
    idVersionNorma: 147960,
    deepLink: "articulo" as const,
    articulos: { "1": 2, "3": 4, "11": 12 },
  };

  it("lands on the cited artículo of an anchored SINALEVI ficha", () => {
    expect(citationUrl(sinalevi, "Artículo 11")).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=98767&param2=147960&param3=3&param4=12&param5=",
    );
    // The chunker also emits all-caps headings.
    expect(citationUrl(sinalevi, "ARTÍCULO 3")).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=98767&param2=147960&param3=3&param4=4&param5=",
    );
  });

  it("falls back to the vigente-text root when no anchor resolves", () => {
    const root =
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=98767&param2=&param3=1&param4=";
    // Artículo the harvest could not place, sub-numbered artículo,
    // transitorio, preámbulo (null) — all root.
    expect(citationUrl(sinalevi, "Artículo 99")).toBe(root);
    expect(citationUrl(sinalevi, "Artículo 3 bis")).toBe(root);
    expect(citationUrl(sinalevi, "Transitorio II")).toBe(root);
    expect(citationUrl(sinalevi, null)).toBe(root);
    // No harvested map (ingested before #134) and explicit opt-out.
    expect(
      citationUrl({ ...sinalevi, articulos: undefined }, "Artículo 11"),
    ).toBe(root);
    expect(
      citationUrl({ ...sinalevi, deepLink: "none" as const }, "Artículo 11"),
    ).toBe(root);
  });

  it("rejects anchor ids that are not positive integers", () => {
    for (const articulos of [
      { "11": -1 },
      { "11": 0 },
      { "11": 1.5 },
      { "11": "12&param9=x" as unknown as number },
    ]) {
      expect(citationUrl({ ...sinalevi, articulos }, "Artículo 11")).toBe(
        "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=98767&param2=&param3=1&param4=",
      );
    }
    expect(
      citationUrl({ ...sinalevi, idVersionNorma: undefined }, "Artículo 11"),
    ).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=98767&param2=&param3=1&param4=",
    );
  });

  it("lands on the first page of a page-ranged PDF source", () => {
    expect(
      citationUrl(
        {
          kind: "pdf",
          url: "https://www.ccss.sa.cr/arc/actas/2018/11/8999.pdf",
          pages: "104-108",
          deepLink: "page",
        },
        "Artículo 30°, sesión 8999",
      ),
    ).toBe("https://www.ccss.sa.cr/arc/actas/2018/11/8999.pdf#page=104");
  });

  it("keeps the document root for sources marked deepLink none", () => {
    expect(
      citationUrl(
        {
          kind: "hacienda-pdf",
          url: "https://www.hacienda.go.cr/docs/TramosRenta2026.pdf",
          deepLink: "none",
        },
        "Artículo 1",
      ),
    ).toBe("https://www.hacienda.go.cr/docs/TramosRenta2026.pdf");
    // A page anchor needs a page range, and never rides on an unsafe scheme.
    expect(
      citationUrl({ kind: "pdf", url: "https://x.cr/a.pdf", deepLink: "page" }),
    ).toBe("https://x.cr/a.pdf");
    expect(
      citationUrl({
        kind: "pdf",
        url: "javascript:alert(1)",
        pages: "1-2",
        deepLink: "page",
      }),
    ).toBeNull();
    // A malformed range is not an anchor.
    expect(
      citationUrl({
        kind: "pdf",
        url: "https://x.cr/a.pdf",
        pages: "0-2",
        deepLink: "page",
      }),
    ).toBe("https://x.cr/a.pdf");
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
  effective_date: "2026-01-01",
  fetched_at: "2026-08-06T15:04:05+00:00",
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
  effectiveAt: ROW.effective_date,
  fetchedAt: ROW.fetched_at,
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
      effectiveAt: "2026-01-01",
      // The chip's "consultado el …" caption (#135) rides along from the
      // document row, so live answers carry it without a second query.
      fetchedAt: "2026-08-06T15:04:05+00:00",
    });
  });

  it("carries the artículo's deep link when the source is anchored (#134)", () => {
    expect(
      toCitation({
        ...CHUNK,
        source: {
          ...CHUNK.source,
          idVersionNorma: 135825,
          deepLink: "articulo",
          articulos: { "2": 3 },
        },
      }).url,
    ).toBe(
      "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=99349&param2=135825&param3=3&param4=3&param5=",
    );
  });
});

function omit<T extends object, K extends keyof T>(obj: T, key: K): Omit<T, K> {
  const copy = { ...obj };
  delete copy[key];
  return copy;
}

const CANONICAL_CITATION: Citation = {
  docKey: "ley-10363",
  docTitle: "Ley del Trabajador Independiente",
  norma: "Ley 10363",
  articulo: "ARTÍCULO 2",
  url: "https://sinalevi.go.cr/ResultadosNormativa/Informacion?param1=99349&param2=&param3=1&param4=",
  effectiveAt: "2026-01-01",
  fetchedAt: "2026-08-06T15:04:05+00:00",
};

describe("isCitation", () => {
  it("accepts the canonical shape", () => {
    expect(isCitation(CANONICAL_CITATION)).toBe(true);
  });

  it("accepts a null articulo", () => {
    expect(isCitation({ ...CANONICAL_CITATION, articulo: null })).toBe(true);
  });

  it("accepts a null norma and url", () => {
    expect(isCitation({ ...CANONICAL_CITATION, norma: null, url: null })).toBe(
      true,
    );
  });

  it("rejects a missing field", () => {
    expect(isCitation(omit(CANONICAL_CITATION, "url"))).toBe(false);
  });

  it("accepts a citation with a fetch date, and one saved before #135 without", () => {
    expect(
      isCitation({ ...CANONICAL_CITATION, fetchedAt: "2026-08-06T15:04:05Z" }),
    ).toBe(true);
    expect(isCitation({ ...CANONICAL_CITATION, fetchedAt: null })).toBe(true);
    // Rows already in `questions` carry no such key — the history view filters
    // with this guard, so a stricter check would blank every saved answer.
    expect(isCitation(omit(CANONICAL_CITATION, "fetchedAt"))).toBe(true);
  });

  it("rejects a wrong-typed fetch date", () => {
    expect(isCitation({ ...CANONICAL_CITATION, fetchedAt: 1754492645 })).toBe(
      false,
    );
  });

  it("accepts an effective date when present and rejects the wrong type", () => {
    expect(isCitation(CANONICAL_CITATION)).toBe(true);
    expect(isCitation({ ...CANONICAL_CITATION, effectiveAt: null })).toBe(true);
    expect(isCitation(omit(CANONICAL_CITATION, "effectiveAt"))).toBe(true);
    expect(isCitation({ ...CANONICAL_CITATION, effectiveAt: 20260101 })).toBe(
      false,
    );
  });

  it("rejects a renamed field", () => {
    expect(
      isCitation({
        ...omit(CANONICAL_CITATION, "docKey"),
        doc_key: "ley-10363",
      }),
    ).toBe(false);
  });

  it("rejects a wrong-typed field", () => {
    expect(isCitation({ ...CANONICAL_CITATION, docKey: 42 })).toBe(false);
  });

  it("rejects non-objects", () => {
    expect(isCitation(null)).toBe(false);
    expect(isCitation("Ley 9635")).toBe(false);
    expect(isCitation(undefined)).toBe(false);
  });
});

describe("parseCitations", () => {
  it("accepts an array of canonical citations", () => {
    expect(parseCitations([CANONICAL_CITATION])).toEqual([CANONICAL_CITATION]);
  });

  it("accepts an empty array", () => {
    expect(parseCitations([])).toEqual([]);
  });

  it("throws on a non-array", () => {
    expect(() => parseCitations(CANONICAL_CITATION)).toThrow(/array/i);
  });

  it("throws when an element is missing a field", () => {
    expect(() => parseCitations([omit(CANONICAL_CITATION, "norma")])).toThrow(
      /not a Citation/i,
    );
  });

  it("throws when an element has a renamed field", () => {
    expect(() =>
      parseCitations([
        { ...omit(CANONICAL_CITATION, "articulo"), article: "ARTÍCULO 2" },
      ]),
    ).toThrow(/not a Citation/i);
  });
});

function fakeEmbedder(dimensions = 3): Embedder {
  const vector = () => new Array<number>(dimensions).fill(0.5);
  return {
    provider: "fake",
    dimensions,
    embed: async (texts) => texts.map(vector),
    embedQuery: async () => vector(),
  };
}

/** An embedder whose interactive path is down — the #127 fallback's trigger. */
function failingEmbedder(error: Error): Embedder {
  return {
    provider: "fake",
    dimensions: 3,
    embed: async () => {
      throw error;
    },
    embedQuery: async () => {
      throw error;
    },
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

  /**
   * The #127 fallback: an embedding provider that cannot answer costs the ask
   * its vector leg, not its life. The vector-leg-shaped detail — that
   * `query_embedding` goes to the RPC as `null` — is the whole contract here,
   * since that is what makes `search_chunks` run lexical-only.
   */
  describe("degraded (lexical-only) fallback", () => {
    const embedFailure = new Error("Voyage embeddings: HTTP 503");

    beforeEach(() => {
      resetDegradedRetrievals();
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
      resetDegradedRetrievals();
    });

    it("runs the query lexical-only when the interactive embed fails", async () => {
      let seen: Record<string, unknown> | undefined;
      const result = await retrieve("¿me cobran retroactivo?", {
        client: fakeClient([{ ...ROW, vector_rank: null }], (args) => {
          seen = args;
        }),
        embedder: failingEmbedder(embedFailure),
      });
      expect(seen).toEqual({
        query_text: "¿me cobran retroactivo?",
        query_embedding: null,
        match_count: DEFAULT_MATCH_COUNT,
      });
      expect(result.isDegraded).toBe(true);
      expect(result.chunks).toHaveLength(1);
    });

    it("does not decline a lexical hit for lacking the corroboration it cannot have", async () => {
      // Every chunk has a null `vectorRank` here by construction, so the
      // usual structural weakness test would decline every degraded ask.
      const result = await retrieve("iva", {
        client: fakeClient([{ ...ROW, vector_rank: null, lexical_rank: 1 }]),
        embedder: failingEmbedder(embedFailure),
      });
      expect(result.isWeak).toBe(false);
      expect(result.isDegraded).toBe(true);
    });

    it("still declines when lexical-only matches nothing at all", async () => {
      const result = await retrieve("algo que no existe", {
        client: fakeClient([]),
        embedder: failingEmbedder(embedFailure),
      });
      expect(result.isWeak).toBe(true);
      expect(result.isDegraded).toBe(true);
    });

    it("leaves a healthy retrieval undegraded", async () => {
      const result = await retrieve("iva", {
        client: fakeClient([ROW]),
        embedder: fakeEmbedder(),
      });
      expect(result.isDegraded).toBe(false);
      expect(degradedRetrievals()).toEqual({ timeout: 0, error: 0 });
    });

    it("counts the degradation and logs it on a stable prefix", async () => {
      await retrieve("iva", {
        client: fakeClient([ROW]),
        embedder: failingEmbedder(embedFailure),
      });
      expect(degradedRetrievals()).toEqual({ timeout: 0, error: 1 });
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("retrieval: degraded to lexical-only"),
      );
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining("reason=error"),
      );
    });

    it("counts a blown budget as a timeout, not a provider error", async () => {
      const timeout = new Error("The operation was aborted due to timeout");
      timeout.name = "TimeoutError";
      await retrieve("iva", {
        client: fakeClient([ROW]),
        embedder: failingEmbedder(timeout),
      });
      expect(degradedRetrievals()).toEqual({ timeout: 1, error: 0 });
    });

    it("reads both abort flavours as a timeout", () => {
      const abort = new Error("aborted");
      abort.name = "AbortError";
      expect(degradedReason(abort)).toBe("timeout");
      expect(degradedReason(new Error("HTTP 500"))).toBe("error");
      expect(degradedReason("not an error at all")).toBe("error");
    });
  });

  // #136: this used to read `search_chunks failed for "<the question>":
  // <the Postgres message>`, and the route logged it. The identity is now the
  // class; the driver's error survives as `cause`, for `describeError`.
  it("surfaces an RPC error as SearchChunksError, carrying neither the query nor the driver's message", async () => {
    const client: RetrievalRpcClient = {
      rpc: async () => ({ data: null, error: { message: "boom" } }),
    };
    const rejection = retrieve("¿cuánto es el IVA para un freelancer?", {
      client,
      embedder: fakeEmbedder(),
    });
    await expect(rejection).rejects.toBeInstanceOf(SearchChunksError);
    await expect(rejection).rejects.toThrow("search_chunks failed");
    const error = await rejection.then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(error?.message).not.toMatch(/IVA|freelancer|boom/i);
    expect(describeError(error)).toBe("SearchChunksError<Object>");
  });
});
