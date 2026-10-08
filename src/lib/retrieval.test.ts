import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_MATCH_COUNT,
  RRF_K,
  citationUrl,
  fuseRrf,
  isCitation,
  isCorroborated,
  lexicalQueryText,
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
import { DERIVED_FIGURES, resolveDerivedFigures } from "./answer/derived";
import { coversFiscalYear, type VigenciaManifest } from "./vigencia";
import manifest from "../../corpus/manifest.json";

/** The deployed manifest, as the slice vigencia reads. */
const manifestDocs: VigenciaManifest["documents"] = manifest.documents;
/** Costa Rica midnight opening fiscal year 2027. */
const IN_2027 = new Date("2027-01-01T06:00:00Z");
/** A manifest with no annual entry: the wire as it was before #505. */
const NO_ANNUAL: VigenciaManifest = { documents: [] };

/** The `reason=` of every degraded-retrieval line logged so far. */
function degradedReasons(): string[] {
  return vi
    .mocked(console.warn)
    .mock.calls.map(([line]) => String(line))
    .filter((line) => line.startsWith("retrieval: degraded to lexical-only"))
    .map((line) => /reason=(\S+)/.exec(line)?.[1] ?? "");
}

describe("lexicalQueryText (#509)", () => {
  it("drops the question words the stop list keeps, accented or not", () => {
    expect(lexicalQueryText("¿Cuánto pago como independiente?")).toBe(
      "¿ pago independiente?",
    );
    expect(lexicalQueryText("¿cuánto pago a la caja?")).toBe(
      "¿ pago a la caja?",
    );
    expect(lexicalQueryText("cuanto pago a la ccss")).toBe("pago a la ccss");
    expect(lexicalQueryText("¿Cuál va a ser la tasa del IVA en 2027?")).toBe(
      "¿ a la tasa del IVA en 2027?",
    );
    expect(lexicalQueryText("¿Dónde y cuándo? ¿Quiénes, cómo, cuántas?")).toBe(
      "¿ y ? ¿, , ?",
    );
  });

  it("matches whole words only, so IVA and Cuantía keep their letters", () => {
    expect(lexicalQueryText("¿Cuantía del IVA para servir?")).toBe(
      "¿Cuantía del IVA para servir?",
    );
  });

  it("leaves a question with no question word as typed", () => {
    expect(lexicalQueryText("¿me cobran retroactivo?")).toBe(
      "¿me cobran retroactivo?",
    );
    expect(lexicalQueryText('"tramos de renta" -2025')).toBe(
      '"tramos de renta" -2025',
    );
  });

  it("leaves no words of a question that is nothing but question words", () => {
    // Its lexical leg finds nothing, so the ask takes the honest decline.
    expect(lexicalQueryText("¿Cómo?")).toBe("¿?");
    expect(lexicalQueryText("¿Cuál va a ser?")).toBe("¿ a ?");
  });
});

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
  expansion_vector_rank: null,
  expansion_lexical_rank: null,
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
  // The unit lane must not reach a provider, and `retrieve`'s default
  // expander (#286) would whenever an Anthropic key happens to be in the
  // environment — which it is for anyone who sourced `.env.local` before
  // `pnpm test`. Cases that want expansion pass their own `expander` and are
  // unaffected by the switch.
  beforeEach(() => {
    vi.stubEnv("EXPAND", "off");
    // Same for the step catalogue (#304): its classifier is free and runs
    // by default, so a question that names a family would put sentences on
    // the wire in every test below. Cases that want it pass their own
    // `steps`.
    vi.stubEnv("STEPS", "off");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes the embedded query and match count to the RPC", async () => {
    let seen: Record<string, unknown> | undefined;
    await retrieve("¿me cobran retroactivo?", {
      client: fakeClient([ROW], (args) => {
        seen = args;
      }),
      embedder: fakeEmbedder(),
      matchCount: 5,
      vigencia: NO_ANNUAL,
    });
    expect(seen).toEqual({
      query_text: "¿me cobran retroactivo?",
      query_embedding: "[0.5,0.5,0.5]",
      match_count: 5,
      // No expander configured: the v4 two-leg contract, on the wire (#286).
      expansion_text: null,
      expansion_embedding: null,
      // And no catalogue (#304): v5's four-leg contract, on the wire.
      step_texts: null,
      step_embeddings: null,
    });
  });

  describe("the question as typed, when its subject alone is weak (#509)", () => {
    const UNCORROBORATED: SearchChunksRow = { ...ROW, vector_rank: null };

    /** Answers by `query_text`, and records each one it was asked. */
    function byQueryText(rows: Record<string, SearchChunksRow[]>) {
      const asked: string[] = [];
      const client: RetrievalRpcClient = {
        rpc: async (_fn, args) => {
          asked.push(args.query_text);
          return { data: rows[args.query_text] ?? [], error: null };
        },
      };
      return { client, asked };
    }

    it("searches the subject first and stops there when it is corroborated", async () => {
      const { client, asked } = byQueryText({
        "¿ pago a la caja?": [ROW],
      });
      const result = await retrieve("¿cuánto pago a la caja?", {
        client,
        embedder: fakeEmbedder(),
        vigencia: NO_ANNUAL,
      });
      expect(asked).toEqual(["¿ pago a la caja?"]);
      expect(result.isWeak).toBe(false);
    });

    it("keeps the as-typed search when the subject alone is weak and it is not", async () => {
      // «¿Cómo emito mi primera factura?»: without «cómo» the strict AND
      // matched one uncorroborated chunk, with it the OR fallback ran wide.
      const asTyped = {
        ...ROW,
        chunk_id: "22222222-2222-2222-2222-222222222222",
      };
      const { client, asked } = byQueryText({
        "¿ emito mi primera factura?": [UNCORROBORATED],
        "¿Cómo emito mi primera factura?": [asTyped],
      });
      const result = await retrieve("¿Cómo emito mi primera factura?", {
        client,
        embedder: fakeEmbedder(),
        vigencia: NO_ANNUAL,
      });
      expect(asked).toEqual([
        "¿ emito mi primera factura?",
        "¿Cómo emito mi primera factura?",
      ]);
      expect(result.isWeak).toBe(false);
      expect(result.chunks.map((c) => c.chunkId)).toEqual([asTyped.chunk_id]);
    });

    it("keeps the subject's search when both are weak", async () => {
      const { client, asked } = byQueryText({
        "¿ emito mi primera factura?": [UNCORROBORATED],
      });
      const result = await retrieve("¿Cómo emito mi primera factura?", {
        client,
        embedder: fakeEmbedder(),
        vigencia: NO_ANNUAL,
      });
      expect(asked).toHaveLength(2);
      expect(result.isWeak).toBe(true);
      expect(result.chunks).toHaveLength(1);
    });

    it("asks once when the question has no question word to drop", async () => {
      const { client, asked } = byQueryText({});
      const result = await retrieve("¿me cobran retroactivo?", {
        client,
        embedder: fakeEmbedder(),
        vigencia: NO_ANNUAL,
      });
      expect(asked).toEqual(["¿me cobran retroactivo?"]);
      expect(result.isWeak).toBe(true);
    });
  });

  it("defaults to the spec's match count", async () => {
    let seen: Record<string, unknown> | undefined;
    await retrieve("iva", {
      client: fakeClient([], (args) => {
        seen = args;
      }),
      embedder: fakeEmbedder(),
      vigencia: NO_ANNUAL,
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
      // Not an annual source: on a 2027 clock `retrieve()` withholds those
      // (#505), and this case is about the mapping, whatever the date.
      doc_key: "tribu-cr-faq",
      doc_title: "Preguntas y respuestas TRIBU-CR y la OVi",
      norma: null,
      articulo: null,
      path: [],
      source: {
        kind: "hacienda-pdf",
        url: "https://www.hacienda.go.cr/docs/dPreguntasYRespuestasDeTRIBU-CR.pdf",
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
      "tribu-cr-faq",
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

  /**
   * #505, ADR 0016: on a 2027 clock a 2026 annual source cannot ground an
   * answer. The year-named keys are the ones a later annual pass can only
   * retire, never carry over, so the case holds through every manifest the
   * owner commits after it.
   */
  it("withholds a past fiscal year's annual sources on a pinned 2027 clock", async () => {
    const rows: SearchChunksRow[] = [
      {
        ...ROW,
        chunk_id: "55555555-5555-5555-5555-555555555555",
        doc_key: "salario-base-2026",
        articulo: "Circular 246-2025",
      },
      {
        ...ROW,
        chunk_id: "66666666-6666-6666-6666-666666666666",
        doc_key: "tramos-renta-2026",
        articulo: null,
      },
      { ...ROW, chunk_id: "33333333-3333-3333-3333-333333333333" },
      {
        ...ROW,
        chunk_id: "44444444-4444-4444-4444-444444444444",
        doc_key: "cnpt",
        articulo: "Artículo 78",
      },
    ];

    const result = await retrieve("¿cuánto es la multa?", {
      client: fakeClient(rows),
      embedder: fakeEmbedder(),
      now: IN_2027,
    });

    expect(result.chunks.map((c) => c.docKey)).toEqual(["ley-10363", "cnpt"]);
    expect(result.citations.map((c) => c.docKey)).toEqual([
      "ley-10363",
      "cnpt",
    ]);
    // The CNPT multa is arithmetic over the 2026 salario base: with its
    // input withheld, no derived figure can state it.
    expect(resolveDerivedFigures(result.chunks)).toEqual([]);

    // A pool of nothing but last year's figures takes the honest decline.
    const stale = await retrieve("¿cuáles son los tramos?", {
      client: fakeClient(rows.slice(0, 2)),
      embedder: fakeEmbedder(),
      now: IN_2027,
    });
    expect(stale.chunks).toEqual([]);
    expect(stale.isWeak).toBe(true);
  });

  /**
   * The same claim over the whole deployed manifest: one chunk per annual
   * entry and per derived-figure input (the BMC's salario mínimo and
   * escalas, the CNPT's salario base). Today that is all six series; after
   * the owner's pass it is whatever still stops at 2026.
   */
  it("lets no 2026-only annual entry, or a figure built on one, through in 2027", async () => {
    const pastIn2027 = new Set(
      manifestDocs
        .filter((doc) => doc.annualChurn && !coversFiscalYear(doc, 2027))
        .map((doc) => doc.doc_key),
    );
    const sources = [
      ...DERIVED_FIGURES.flatMap((figure) =>
        figure.inputs.map(({ docKey, articulo }) => ({ docKey, articulo })),
      ),
      ...manifestDocs
        .filter((doc) => doc.annualChurn)
        .map((doc) => ({ docKey: doc.doc_key, articulo: null })),
    ];
    const rows = sources.map(
      ({ docKey, articulo }, index): SearchChunksRow => ({
        ...ROW,
        chunk_id: `00000000-0000-0000-0000-${String(index).padStart(12, "0")}`,
        doc_key: docKey,
        articulo,
      }),
    );

    const result = await retrieve("¿cuánto pago?", {
      client: fakeClient(rows),
      embedder: fakeEmbedder(),
      matchCount: rows.length,
      now: IN_2027,
    });

    expect(
      result.chunks.filter((chunk) => pastIn2027.has(chunk.docKey)),
    ).toEqual([]);
    expect(
      resolveDerivedFigures(result.chunks).filter((figure) =>
        figure.inputs.some((input) => pastIn2027.has(input.docKey)),
      ),
    ).toEqual([]);
  });

  it("asks for twice the rows while a source is out of period, and refills the count", async () => {
    const december: VigenciaManifest = {
      documents: [
        {
          doc_key: "tramos-renta-2026",
          effective_date: "2026-01-01",
          annualChurn: true,
        },
        {
          doc_key: "tramos-renta-2027",
          effective_date: "2027-01-01",
          annualChurn: true,
        },
      ],
    };
    const tramos = (chunkId: string, docKey: string): SearchChunksRow => ({
      ...ROW,
      chunk_id: chunkId,
      doc_key: docKey,
      articulo: null,
    });
    let seen: Record<string, unknown> | undefined;
    const result = await retrieve("tramos de renta", {
      client: fakeClient(
        [
          tramos("77777777-7777-7777-7777-777777777777", "tramos-renta-2027"),
          tramos("88888888-8888-8888-8888-888888888888", "tramos-renta-2026"),
          ROW,
          { ...ROW, chunk_id: "99999999-9999-9999-9999-999999999999" },
        ],
        (args) => {
          seen = args;
        },
      ),
      embedder: fakeEmbedder(),
      matchCount: 2,
      now: new Date("2026-12-15T06:00:00Z"),
      vigencia: december,
    });

    expect(seen?.match_count).toBe(4);
    // Next year's source waits for 1 January; the count is still two.
    expect(result.chunks.map((c) => c.docKey)).toEqual([
      "tramos-renta-2026",
      "ley-10363",
    ]);
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
  describe("the step catalogue legs (#304)", () => {
    const probe = {
      family: "T1-B" as const,
      sentences: ["Dónde se afilia.", "Cuándo se paga la cuota."],
    };

    it("sends each sentence and its embedding beside the question's", async () => {
      let seen: Record<string, unknown> | undefined;
      const result = await retrieve("¿Y dónde me afilio?", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder: fakeEmbedder(),
        steps: { probe: () => probe },
      });

      expect(seen).toMatchObject({
        // Without its question word: the lexical leg's text (#509).
        query_text: "¿Y me afilio?",
        query_embedding: "[0.5,0.5,0.5]",
        step_texts: ["Dónde se afilia.", "Cuándo se paga la cuota."],
        step_embeddings: ["[0.5,0.5,0.5]", "[0.5,0.5,0.5]"],
      });
      // Reported, so the rerank can score the sentences and the harness can
      // print the family.
      expect(result.steps).toEqual(probe);
    });

    it("runs the production classifier by default and none under STEPS=off", async () => {
      vi.stubEnv("STEPS", "");
      let seen: Record<string, unknown> | undefined;
      const on = await retrieve(
        "¿Me puedo desinscribir si debo declaraciones?",
        {
          client: fakeClient([ROW], (args) => {
            seen = args;
          }),
          embedder: fakeEmbedder(),
        },
      );
      expect(on.steps?.family).toBe("T1-H");
      expect(seen?.step_texts).toEqual(on.steps?.sentences);

      vi.stubEnv("STEPS", "off");
      const off = await retrieve(
        "¿Me puedo desinscribir si debo declaraciones?",
        {
          client: fakeClient([ROW], (args) => {
            seen = args;
          }),
          embedder: fakeEmbedder(),
        },
      );
      expect(off.steps).toBeNull();
      expect(seen).toMatchObject({ step_texts: null, step_embeddings: null });
    });

    it("searches without a catalogue when the question names no family", async () => {
      let seen: Record<string, unknown> | undefined;
      const result = await retrieve("iva", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder: fakeEmbedder(),
        steps: { probe: () => null },
      });
      expect(seen).toMatchObject({ step_texts: null, step_embeddings: null });
      expect(result.steps).toBeNull();
    });

    it("keeps a sentence's lexical leg when its embed fails, and is not degraded", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      let seen: Record<string, unknown> | undefined;
      const embedder: Embedder = {
        ...fakeEmbedder(),
        embedQuery: async (text) => {
          if (text === "Cuándo se paga la cuota.")
            throw new Error("voyage 500");
          return [0.5, 0.5, 0.5];
        },
      };
      const result = await retrieve("¿Y dónde me afilio?", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder,
        steps: { probe: () => probe },
      });
      expect(seen).toMatchObject({
        query_embedding: "[0.5,0.5,0.5]",
        step_texts: ["Dónde se afilia.", "Cuándo se paga la cuota."],
        // The slot stays, null, so texts and embeddings line up by index.
        step_embeddings: ["[0.5,0.5,0.5]", null],
      });
      expect(result.isDegraded).toBe(false);
      expect(degradedReasons()).toEqual([]);
      vi.mocked(console.warn).mockRestore();
    });

    it("maps the step ranks onto the chunk", async () => {
      const result = await retrieve("¿Y dónde me afilio?", {
        client: fakeClient([
          { ...ROW, step_vector_rank: 2, step_lexical_rank: null },
        ]),
        embedder: fakeEmbedder(),
        steps: { probe: () => probe },
      });
      expect(result.chunks[0]).toMatchObject({
        stepVectorRank: 2,
        stepLexicalRank: null,
      });
    });

    it("never lets the catalogue witness corroboration", async () => {
      // A chunk only the catalogue found — by both of its legs — is the
      // probe's match, not the reader's: the probe is the same text for
      // every question in the family (#307's rule, applied to #304).
      const catalogueOnly: SearchChunksRow = {
        ...ROW,
        vector_rank: null,
        lexical_rank: null,
        step_vector_rank: 1,
        step_lexical_rank: 1,
      };
      const result = await retrieve("¿Y dónde me afilio?", {
        client: fakeClient([catalogueOnly]),
        embedder: fakeEmbedder(),
        steps: { probe: () => probe },
      });
      expect(result.chunks).toHaveLength(1);
      expect(result.isWeak).toBe(true);

      // Nor on the degraded path, where "the reader's own words matched"
      // is the whole test.
      const degraded = await retrieve("¿Y dónde me afilio?", {
        client: fakeClient([catalogueOnly]),
        embedder: failingEmbedder(new Error("voyage 503")),
        steps: { probe: () => probe },
      });
      expect(degraded.isDegraded).toBe(true);
      expect(degraded.isWeak).toBe(true);
    });
  });

  describe("the expansion legs (#286)", () => {
    it("sends the rewrite and its embedding beside the question's", async () => {
      let seen: Record<string, unknown> | undefined;
      const result = await retrieve("Me inscribí un año tarde, ¿qué me pasa?", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder: fakeEmbedder(),
        expander: {
          expand: async () => "Omisión de la declaración de inscripción",
        },
      });

      expect(seen).toMatchObject({
        query_text: "Me inscribí un año tarde, ¿ me pasa?",
        query_embedding: "[0.5,0.5,0.5]",
        expansion_text: "Omisión de la declaración de inscripción",
        expansion_embedding: "[0.5,0.5,0.5]",
      });
      // Reported, so a caller can say which search actually ran.
      expect(result.expansion).toBe("Omisión de la declaración de inscripción");
    });

    it("searches the question alone when the expander declines", async () => {
      let seen: Record<string, unknown> | undefined;
      const result = await retrieve("iva", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder: fakeEmbedder(),
        expander: { expand: async () => null },
      });

      expect(seen).toMatchObject({
        expansion_text: null,
        expansion_embedding: null,
      });
      expect(result.expansion).toBeNull();
    });

    it("keeps the expansion's lexical leg when its embed fails", async () => {
      // An expansion the embedder cannot vectorise is not a degradation: the
      // question's own legs are untouched, so the reader is not told that the
      // search was thinner than usual — it was thicker than v4's.
      let seen: Record<string, unknown> | undefined;
      const embedder: Embedder = {
        ...fakeEmbedder(),
        embedQuery: async (text) => {
          if (text === "expansión") throw new Error("voyage 500");
          return [0.5, 0.5, 0.5];
        },
      };

      const result = await retrieve("iva", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder,
        expander: { expand: async () => "expansión" },
      });

      expect(seen).toMatchObject({
        query_embedding: "[0.5,0.5,0.5]",
        expansion_text: "expansión",
        expansion_embedding: null,
      });
      expect(result.isDegraded).toBe(false);
    });

    it("makes no call at all when the caller opts out", async () => {
      let seen: Record<string, unknown> | undefined;
      await retrieve("iva", {
        client: fakeClient([ROW], (args) => {
          seen = args;
        }),
        embedder: fakeEmbedder(),
        expander: null,
      });

      expect(seen).toMatchObject({
        expansion_text: null,
        expansion_embedding: null,
      });
    });

    it("stays weak on the degraded path when only the expansion matched", async () => {
      // The same hole as corroboration, on the path where corroboration is
      // not available: the question's embed failed, so its vector leg never
      // ran, and the pool can be filled entirely by chunks a model-written
      // passage found. "Not empty" would clear the honest decline of #21 on
      // the strength of the expansion alone; "the reader's own words matched
      // something" is what lexical-only can still honestly say.
      const expansionOnly: SearchChunksRow = {
        ...ROW,
        vector_rank: null,
        lexical_rank: null,
        expansion_lexical_rank: 1,
      };
      const degraded = await retrieve("iva", {
        client: fakeClient([expansionOnly]),
        embedder: failingEmbedder(new Error("voyage 503")),
        expander: { expand: async () => "expansión" },
      });
      expect(degraded.isDegraded).toBe(true);
      expect(degraded.chunks).toHaveLength(1);
      expect(degraded.isWeak).toBe(true);

      // And a degraded ask the question's own words *did* match is not weak,
      // which is the whole point of #127's fallback.
      const answered = await retrieve("iva", {
        client: fakeClient([{ ...ROW, vector_rank: null, lexical_rank: 3 }]),
        embedder: failingEmbedder(new Error("voyage 503")),
        expander: { expand: async () => "expansión" },
      });
      expect(answered.isDegraded).toBe(true);
      expect(answered.isWeak).toBe(false);
    });

    it("needs the reader's own words to match; the expansion never flips it (#307)", () => {
      // The lexical leg is the only one that can miss: the vector leg ranks
      // the whole corpus for any string, and the expansion is a passage a
      // model wrote for this question — it writes one for any question, in
      // the corpus's register, so its legs match real chunks even for
      // gibberish. #286 let raw-vector + expansion-lexical corroborate, and
      // a nonsense question stopped tripping isWeak. Now: raw lexical, plus
      // similarity from either the question or its expansion.
      expect(
        isCorroborated({
          vectorRank: null,
          lexicalRank: null,
          expansionVectorRank: 1,
          expansionLexicalRank: 1,
        }),
      ).toBe(false);
      // The #307 case: raw vector always hits, expansion lexical matched the
      // model's refusal. Not corroborated.
      expect(
        isCorroborated({
          vectorRank: 3,
          lexicalRank: null,
          expansionVectorRank: 8,
          expansionLexicalRank: 4,
        }),
      ).toBe(false);
      expect(
        isCorroborated({
          vectorRank: 3,
          lexicalRank: null,
          expansionVectorRank: 1,
          expansionLexicalRank: null,
        }),
      ).toBe(false);
      // The reader's words matched and the expansion's embedding found it:
      // two independent witnesses, corroborated.
      expect(
        isCorroborated({
          vectorRank: null,
          lexicalRank: 5,
          expansionVectorRank: 2,
          expansionLexicalRank: null,
        }),
      ).toBe(true);
      // Words alone, from either register, are not enough.
      expect(
        isCorroborated({
          vectorRank: null,
          lexicalRank: 5,
          expansionVectorRank: null,
          expansionLexicalRank: 2,
        }),
      ).toBe(false);
    });
  });

  describe("degraded (lexical-only) fallback", () => {
    const embedFailure = new Error("Voyage embeddings: HTTP 503");

    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
      vi.restoreAllMocks();
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
        expansion_text: null,
        expansion_embedding: null,
        step_texts: null,
        step_embeddings: null,
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
      expect(degradedReasons()).toEqual([]);
    });

    it("counts the degradation and logs it on a stable prefix", async () => {
      await retrieve("iva", {
        client: fakeClient([ROW]),
        embedder: failingEmbedder(embedFailure),
      });
      expect(degradedReasons()).toEqual(["error"]);
    });

    it("counts a blown budget as a timeout, not a provider error", async () => {
      const timeout = new Error("The operation was aborted due to timeout");
      timeout.name = "TimeoutError";
      await retrieve("iva", {
        client: fakeClient([ROW]),
        embedder: failingEmbedder(timeout),
      });
      expect(degradedReasons()).toEqual(["timeout"]);
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
