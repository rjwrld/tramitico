import { describe, expect, it } from "vitest";
import {
  citationUrl,
  searchChunks,
  type SearchChunksClient,
} from "./retrieval";
import type { Embedder } from "./ingestion/embedder";

describe("citationUrl", () => {
  it("derives the public SCIJ page for a sinalevi source", () => {
    const url = citationUrl({
      kind: "sinalevi",
      idFichaNorma: 99349,
      idVersionNorma: 135825,
    });
    expect(url).toBe(
      "https://pgrweb.go.cr/scij/Busqueda/Normativa/Normas/nrm_texto_completo.aspx?param1=NRTC&nValor1=1&nValor2=99349&nValor3=135825&strTipM=TC",
    );
  });

  it("uses the direct url for a hacienda-pdf source", () => {
    const url = citationUrl({
      kind: "hacienda-pdf",
      url: "https://www.hacienda.go.cr/docs/TramosRenta2026.pdf",
    });
    expect(url).toBe("https://www.hacienda.go.cr/docs/TramosRenta2026.pdf");
  });

  it("uses the catalog url for a cabys source", () => {
    const url = citationUrl({
      kind: "cabys",
      catalog:
        "https://www.bccr.fi.cr/indicadores-economicos/cat%C3%A1logo-de-bienes-y-servicios",
    });
    expect(url).toBe(
      "https://www.bccr.fi.cr/indicadores-economicos/cat%C3%A1logo-de-bienes-y-servicios",
    );
  });

  it("fails loudly on an unresolved source", () => {
    expect(() => citationUrl({ kind: "unresolved", hint: "todo" })).toThrow(
      /unresolved/,
    );
  });

  it("fails loudly on a source shape it doesn't recognize", () => {
    const malformed = { kind: "bogus" } as unknown as Parameters<
      typeof citationUrl
    >[0];
    expect(() => citationUrl(malformed)).toThrow(/cannot derive/);
  });
});

const stubEmbedder: Embedder = {
  provider: "stub",
  dimensions: 1,
  embed: async (texts) => texts.map(() => [0]),
};

describe("searchChunks", () => {
  it("maps RPC rows to typed chunks and exposes the top score", async () => {
    const fakeClient: SearchChunksClient = {
      rpc: async (_fn, args) => {
        expect(args).toEqual({
          query_text: "prescripción CCSS",
          query_embedding: JSON.stringify([0]),
          match_count: 8,
        });
        return {
          data: [
            {
              chunk_id: "chunk-1",
              doc_key: "ley-10363",
              doc_title: "Ley del Trabajador Independiente",
              norma: "Ley 10363",
              articulo: "ARTÍCULO 2",
              path: ["CAPÍTULO I"],
              part: 0,
              content: "...",
              source: { kind: "sinalevi", idFichaNorma: 1, idVersionNorma: 2 },
              score: 0.0164,
            },
          ],
          error: null,
        };
      },
    };

    const result = await searchChunks("prescripción CCSS", 8, {
      supabase: fakeClient,
      embedder: stubEmbedder,
    });

    expect(result.chunks).toEqual([
      {
        chunkId: "chunk-1",
        docKey: "ley-10363",
        docTitle: "Ley del Trabajador Independiente",
        norma: "Ley 10363",
        articulo: "ARTÍCULO 2",
        path: ["CAPÍTULO I"],
        part: 0,
        content: "...",
        source: { kind: "sinalevi", idFichaNorma: 1, idVersionNorma: 2 },
        score: 0.0164,
      },
    ]);
    expect(result.topScore).toBe(0.0164);
  });

  it("returns a zero top score when nothing matches", async () => {
    const fakeClient: SearchChunksClient = {
      rpc: async () => ({ data: [], error: null }),
    };

    const result = await searchChunks("no matches", 8, {
      supabase: fakeClient,
      embedder: stubEmbedder,
    });

    expect(result.chunks).toEqual([]);
    expect(result.topScore).toBe(0);
  });

  it("fails loudly when the RPC errors", async () => {
    const fakeClient: SearchChunksClient = {
      rpc: async () => ({
        data: null,
        error: { message: "permission denied" },
      }),
    };

    await expect(
      searchChunks("q", 8, { supabase: fakeClient, embedder: stubEmbedder }),
    ).rejects.toThrow(/permission denied/);
  });
});
