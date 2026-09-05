import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  ANSWER_TOP_K,
  RERANK_MODEL,
  RERANK_POOL,
  answerTopK,
  rerankChunks,
  rerankOrder,
} from "./rerank";

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
    // No top_k since #287: Voyage scores the whole pool either way, and the
    // full order is what names the chunk that displaced a missed target.
    expect(body.top_k).toBeUndefined();
    expect(body.documents).toHaveLength(12);
  });

  it("cuts the reranked order at the ANSWER_TOP_K override (#287)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    vi.stubEnv("ANSWER_TOP_K", "10");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: Array.from({ length: 12 }, (_, index) => ({
            index,
            relevance_score: 1,
          })),
        }),
        { status: 200 },
      ),
    );
    const result = await rerankChunks("pregunta", POOL, { fetchImpl });
    expect(result).toHaveLength(10);
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

describe("answerTopK", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to the SPEC §5 top-8", () => {
    vi.stubEnv("ANSWER_TOP_K", "");
    expect(answerTopK()).toBe(ANSWER_TOP_K);
  });

  it("takes a larger answer top-k from the environment (#287 option 1)", () => {
    vi.stubEnv("ANSWER_TOP_K", "12");
    expect(answerTopK()).toBe(12);
  });

  it("ignores a value that is not a positive integer", () => {
    for (const value of ["0", "-3", "8.5", "muchos"]) {
      vi.stubEnv("ANSWER_TOP_K", value);
      expect(answerTopK()).toBe(ANSWER_TOP_K);
    }
  });
});

describe("rerankOrder", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  function voyage(indices: number[]) {
    return vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: indices.map((index, position) => ({
            index,
            relevance_score: 1 - position / 100,
          })),
        }),
        { status: 200 },
      ),
    );
  }

  it("returns the whole pool in rank order, with scores and 1-based ranks", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const order = await rerankOrder("pregunta", POOL, {
      fetchImpl: voyage([11, 3, 0]),
    });
    expect(order?.map((r) => [r.chunk.chunkId, r.rank])).toEqual([
      ["c12", 1],
      ["c4", 2],
      ["c1", 3],
    ]);
    expect(order?.[0].score).toBeCloseTo(1);
  });

  it("asks Voyage for the model named by RERANK_MODEL (#287 option 2)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    vi.stubEnv("RERANK_MODEL", "rerank-2.5");
    const fetchImpl = voyage([0]);
    await rerankOrder("pregunta", POOL, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe(
      "rerank-2.5",
    );
  });

  it("falls back to the model of record when RERANK_MODEL is unset", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    vi.stubEnv("RERANK_MODEL", "");
    const fetchImpl = voyage([0]);
    await rerankOrder("pregunta", POOL, { fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body).model).toBe(
      RERANK_MODEL,
    );
  });

  it("returns null — never throws — when the rerank does not happen", async () => {
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    vi.stubEnv("RERANK", "off");
    expect(
      await rerankOrder("pregunta", POOL, { fetchImpl: vi.fn() }),
    ).toBeNull();
    vi.stubEnv("RERANK", "voyage");
    expect(
      await rerankOrder("pregunta", POOL, {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response("nope", { status: 500 })),
      }),
    ).toBeNull();
    expect(
      await rerankOrder("pregunta", POOL, {
        fetchImpl: vi.fn().mockRejectedValue(new Error("aborted")),
      }),
    ).toBeNull();
  });
});
