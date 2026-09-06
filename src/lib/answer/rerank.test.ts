import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  ANSWER_TOP_K,
  RERANK_MODEL,
  RERANK_POOL,
  answerTopK,
  rerankChunks,
  fuseByMaxScore,
  rerankOrder,
  rerankQueries,
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

describe("the rerank queries (#286, recomposed in #296)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("is the question, then its expansion — two readings, never one string", () => {
    expect(
      rerankQueries("¿desde cuánta plata?", "base mínima contributiva"),
    ).toEqual(["¿desde cuánta plata?", "base mínima contributiva"]);
  });

  it("is the question alone when there is no expansion", () => {
    for (const expansion of [undefined, null, ""]) {
      expect(rerankQueries("¿desde cuánta plata?", expansion)).toEqual([
        "¿desde cuánta plata?",
      ]);
    }
  });

  it("sends each one to Voyage as its own query, over the same documents", async () => {
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body.query);
      expect(body.documents).toEqual(["contenido 1"]);
      return new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 1 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;

    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    await rerankChunks("pregunta", [chunk(1)], {
      fetchImpl,
      expansion: "términos oficiales",
    });

    expect(sent).toEqual(["pregunta", "términos oficiales"]);
  });

  it("makes one call, not two, when there is no expansion", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 1 }] }),
        {
          status: 200,
        },
      ),
    );
    await rerankChunks("pregunta", [chunk(1)], { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("fuseByMaxScore (#296)", () => {
  /** Voyage's shape: scored pool indices, best first. */
  const question = [
    { index: 0, score: 0.9 },
    { index: 2, score: 0.5 },
    { index: 1, score: 0.2 },
  ];

  it("keeps the best score either reading gave a chunk", () => {
    // Chunk 1 is what the expansion is for: the question barely scores it and
    // the corpus-register rewrite recognises it.
    const expansion = [
      { index: 1, score: 0.95 },
      { index: 2, score: 0.4 },
      { index: 0, score: 0.1 },
    ];
    expect(fuseByMaxScore([question, expansion])).toEqual([
      { index: 1, score: 0.95 },
      { index: 0, score: 0.9 },
      { index: 2, score: 0.5 },
    ]);
  });

  it("never lowers a chunk below the score the question alone gave it", () => {
    // The whole point of #296: a rewrite that drifted into another country's
    // law scores everything badly and takes nothing down with it.
    const drifted = [0, 1, 2].map((index) => ({ index, score: 0.01 }));
    const asked = new Map(question.map((r) => [r.index, r.score]));
    for (const { index, score } of fuseByMaxScore([question, drifted])) {
      expect(score).toBeGreaterThanOrEqual(asked.get(index) ?? 0);
    }
  });

  it("breaks a tie on the question's own order, then on pool position", () => {
    // Every chunk ties at 0.7, so only the tiebreak decides.
    const tied = (indices: number[]) =>
      indices.map((index) => ({ index, score: 0.7 }));
    expect(
      fuseByMaxScore([tied([2, 0, 1]), tied([0, 1, 2])]).map((r) => r.index),
    ).toEqual([2, 0, 1]);
    // A chunk the question never returned sorts behind the ones it did, and
    // pool position settles the rest.
    expect(
      fuseByMaxScore([tied([2]), tied([0, 1, 2])]).map((r) => r.index),
    ).toEqual([2, 0, 1]);
  });

  it("tolerates a reading that failed, from either side", () => {
    expect(fuseByMaxScore([question, null]).map((r) => r.index)).toEqual([
      0, 2, 1,
    ]);
    expect(fuseByMaxScore([null, question]).map((r) => r.index)).toEqual([
      0, 2, 1,
    ]);
    expect(fuseByMaxScore([null, null])).toEqual([]);
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

  it("falls back to the reading that came back when the other one failed (#296)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    // The question's call fails; the expansion's answers. One reading is
    // still a better order than the fused one, so the rerank must not be lost.
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [
              { index: 5, relevance_score: 0.9 },
              { index: 2, relevance_score: 0.4 },
            ],
          }),
          { status: 200 },
        ),
      );
    const order = await rerankOrder("pregunta", POOL, {
      fetchImpl,
      expansion: "términos oficiales",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(order?.map((r) => [r.chunk.chunkId, r.rank])).toEqual([
      ["c6", 1],
      ["c3", 2],
    ]);
  });

  it("returns null when both readings fail (#296)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    expect(
      await rerankOrder("pregunta", POOL, {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(new Response("nope", { status: 500 })),
        expansion: "términos oficiales",
      }),
    ).toBeNull();
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
