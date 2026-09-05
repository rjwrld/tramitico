import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import { ANSWER_TOP_K, RERANK_POOL, rerankChunks, rerankQuery } from "./rerank";

function chunk(id: number): RetrievedChunk {
  return {
    chunkId: `c${id}`,
    docKey: `doc-${id}`,
    docTitle: `Doc ${id}`,
    norma: null,
    articulo: null,
    path: [],
    part: 0,
    content: `contenido ${id}`,
    source: {},
    fetchedAt: "2026-08-06T15:04:05Z",
    score: 1 / (60 + id),
    vectorRank: id,
    lexicalRank: id,
  };
}

const POOL = Array.from({ length: 12 }, (_, i) => chunk(i + 1));

describe("rerankChunks", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("exposes the pool and top-k constants from the #21 design note", () => {
    expect(RERANK_POOL).toBe(40);
    expect(ANSWER_TOP_K).toBe(8);
  });

  it("returns fused-order top-8 when RERANK=off", async () => {
    vi.stubEnv("RERANK", "off");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const fetchImpl = vi.fn();
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(result).toEqual(POOL.slice(0, 8));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reranks by default — no RERANK env var needed (#25 validated the lift)", async () => {
    vi.stubEnv("RERANK", "");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [{ index: 1, relevance_score: 1 }] }),
          { status: 200 },
        ),
      );
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(result.map((c) => c.chunkId)).toEqual(["c2"]);
  });

  it("reorders via Voyage and returns top-8 when RERANK=voyage", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          // Voyage returns results sorted by relevance, top_k applied.
          data: [11, 3, 0, 1, 2, 4, 5, 6].map((index) => ({
            index,
            relevance_score: 1,
          })),
        }),
        { status: 200 },
      ),
    );
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(result.map((c) => c.chunkId)).toEqual([
      "c12",
      "c4",
      "c1",
      "c2",
      "c3",
      "c5",
      "c6",
      "c7",
    ]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain("voyageai.com");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("rerank-2.5-lite");
    expect(body.query).toBe("pregunta");
    expect(body.top_k).toBe(8);
    expect(body.documents).toHaveLength(12);
  });

  it("falls back to fused order when Voyage errors", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(result).toEqual(POOL.slice(0, 8));
  });

  it("falls back to fused order when the request rejects (timeout)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const fetchImpl = vi.fn().mockRejectedValue(new Error("aborted"));
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(result).toEqual(POOL.slice(0, 8));
  });

  it("falls back to fused order when the key is missing", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "");
    const fetchImpl = vi.fn();
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(result).toEqual(POOL.slice(0, 8));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("the rerank query (#286)", () => {
  it("appends the expansion, and keeps the question", () => {
    expect(
      rerankQuery("¿desde cuánta plata?", "base mínima contributiva"),
    ).toBe("¿desde cuánta plata? base mínima contributiva");
  });

  it("is the question alone when there is no expansion", () => {
    expect(rerankQuery("¿desde cuánta plata?")).toBe("¿desde cuánta plata?");
    expect(rerankQuery("¿desde cuánta plata?", null)).toBe(
      "¿desde cuánta plata?",
    );
    expect(rerankQuery("¿desde cuánta plata?", "")).toBe(
      "¿desde cuánta plata?",
    );
  });

  it("sends that composed query to Voyage", async () => {
    let sent: string | undefined;
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(init.body as string).query;
      return new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 1 }] }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }) as unknown as typeof fetch;

    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    await rerankChunks("pregunta", [chunk(1)], {
      fetchImpl,
      expansion: "términos oficiales",
    });

    expect(sent).toBe("pregunta términos oficiales");
  });
});
