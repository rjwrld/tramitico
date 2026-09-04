import { describe, expect, it, vi } from "vitest";
import {
  ingestDocument,
  type DocumentEmbedder,
  type IngestableDocument,
} from "./ingest-document";
import type {
  DocumentRowClient,
  DocumentIdentity,
  DocumentStamp,
  ReplaceChunksArgs,
  ReplaceRpcClient,
} from "./replace";

const DOC_ID = "3f2c8a1e-0000-4000-8000-000000000206";

/**
 * A database that records what it was asked to do, in order. The order is
 * the thing under test: "identity, chunks, stamp" is what keeps `fetched_at`
 * honest, and "nothing at all" is what a failed extraction must produce.
 */
function fakeClient(rpcError?: { message: string }) {
  const calls: string[] = [];
  const identities: DocumentIdentity[] = [];
  const stamps: DocumentStamp[] = [];
  const rpcArgs: ReplaceChunksArgs[] = [];
  const client = {
    from() {
      return {
        upsert(values: DocumentIdentity) {
          calls.push("identity");
          identities.push(values);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({ data: { id: DOC_ID }, error: null }),
            }),
          };
        },
        update(values: DocumentStamp) {
          calls.push("stamp");
          stamps.push(values);
          return { eq: () => Promise.resolve({ error: null }) };
        },
      };
    },
    rpc(fn: "replace_chunks", args: ReplaceChunksArgs) {
      calls.push(fn);
      rpcArgs.push(args);
      return Promise.resolve(
        rpcError
          ? { data: null, error: rpcError }
          : { data: args.p_chunks.length, error: null },
      );
    },
  } satisfies DocumentRowClient & ReplaceRpcClient;
  return { client, calls, identities, stamps, rpcArgs };
}

function fakeEmbedder(): DocumentEmbedder & {
  embed: ReturnType<typeof vi.fn>;
} {
  return {
    provider: "stub",
    dimensions: 3,
    embed: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
  };
}

const doc: IngestableDocument = {
  doc_key: "ccss-escala-salud",
  title: "CCSS — Escala Salud",
  norma: null,
  source: { kind: "pdf", pages: "104-108" },
  effective_date: "2024-01-01",
  chunking: { articulo: "Artículo 30°, sesión 8999" },
};

describe("ingestDocument", () => {
  /**
   * The #206 acceptance criterion, at the seam the runner actually calls: a
   * recrawl whose extraction recovered no text has to fail *before*
   * `replace_chunks` gets a chance to delete the document's real chunks.
   */
  it("refuses an extraction that recovered nothing, writing nothing at all", async () => {
    const { client, calls } = fakeClient();
    const embedder = fakeEmbedder();

    await expect(ingestDocument({ client, embedder }, doc, [])).rejects.toThrow(
      /ccss-escala-salud/,
    );

    expect(calls).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("refuses whitespace-only paragraphs the same way", async () => {
    const { client, calls } = fakeClient();
    const embedder = fakeEmbedder();

    await expect(
      ingestDocument({ client, embedder }, doc, ["   ", "\n"]),
    ).rejects.toThrow(/ccss-escala-salud/);

    expect(calls).toEqual([]);
  });

  it("refuses a FAQ below its question-count floor before writing", async () => {
    const { client, calls } = fakeClient();
    const embedder = fakeEmbedder();

    await expect(
      ingestDocument(
        { client, embedder },
        {
          ...doc,
          doc_key: "tribu-cr-faq",
          chunking: { questions: { minimum: 3 } },
        },
        [
          "Declaraciones y Pagos",
          "1. ¿Primera pregunta? Primera respuesta.",
          "2. ¿Segunda pregunta? Segunda respuesta.",
        ],
      ),
    ).rejects.toThrow(/found 2 question headings; expected at least 3/);

    expect(calls).toEqual([]);
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it("writes identity, then chunks, then the freshness stamp", async () => {
    const { client, calls, identities, stamps, rpcArgs } = fakeClient();
    const embedder = fakeEmbedder();

    const written = await ingestDocument(
      { client, embedder, now: () => "2026-08-31T12:00:00.000Z" },
      doc,
      ["Trabajador independiente: 2.89%."],
    );

    expect(written).toBe(1);
    expect(calls).toEqual(["identity", "replace_chunks", "stamp"]);
    expect(identities[0]).toEqual({
      doc_key: "ccss-escala-salud",
      title: "CCSS — Escala Salud",
      norma: null,
      source: { kind: "pdf", pages: "104-108" },
      effective_date: "2024-01-01",
    });
    // The identity write carries no freshness columns — that is what lets a
    // failure after it leave the previous run's stamp standing.
    expect(identities[0]).not.toHaveProperty("fetched_at");
    expect(stamps[0]).toEqual({
      fetched_at: "2026-08-31T12:00:00.000Z",
      embedding_provider: "stub",
      embedding_dim: 3,
    });
    expect(rpcArgs[0].p_chunks[0].content).toContain("2.89%");
    expect(rpcArgs[0].p_chunks[0].embedding).toEqual([0.1, 0.2, 0.3]);
  });

  it("never stamps when replace_chunks fails", async () => {
    const { client, calls } = fakeClient({ message: "malformed vector" });
    const embedder = fakeEmbedder();

    await expect(
      ingestDocument({ client, embedder }, doc, ["Texto."]),
    ).rejects.toThrow(/replace_chunks failed/);

    expect(calls).toEqual(["identity", "replace_chunks"]);
  });

  it("hands the embedder its chunks in batches, in order", async () => {
    const { client, rpcArgs } = fakeClient();
    const embedder = fakeEmbedder();
    // 150 artículos → 150 chunks → three embed calls of 64/64/22.
    const paragraphs = Array.from(
      { length: 150 },
      (_, i) => `Artículo ${i + 1}- Texto ${i + 1}.`,
    );

    await ingestDocument(
      { client, embedder },
      { ...doc, chunking: undefined },
      paragraphs,
    );

    expect(
      embedder.embed.mock.calls.map((call) => (call[0] as string[]).length),
    ).toEqual([64, 64, 22]);
    expect(rpcArgs[0].p_chunks).toHaveLength(150);
    expect(rpcArgs[0].p_chunks[149].content).toContain("Texto 150.");
  });
});
