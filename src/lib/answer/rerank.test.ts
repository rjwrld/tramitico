import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievedChunk } from "../retrieval";
import {
  ANSWER_DOC_CAP,
  ANSWER_TOP_K,
  RERANK_MODEL,
  RERANK_POOL,
  type RerankedChunk,
  answerDocCap,
  answerSetFromOrder,
  answerTopK,
  capPerDocument,
  rerankChunks,
  fuseByMaxScore,
  rerankOrder,
  rerankQueries,
  rerankReadings,
  STEP_RERANK_MODE,
  stepRerankMode,
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

  it("adds the step catalogue's sentences after the expansion, one query each (#304)", () => {
    expect(
      rerankQueries("¿y dónde me afilio?", "trámite de afiliación", [
        "Dónde se afilia.",
        "Cuándo se paga la cuota.",
      ]),
    ).toEqual([
      "¿y dónde me afilio?",
      "trámite de afiliación",
      "Dónde se afilia.",
      "Cuándo se paga la cuota.",
    ]);
    // The question is always first — the tiebreak in `fuseByMaxScore`
    // reads slot 0 as the reader's own reading.
    expect(
      rerankQueries("¿y dónde me afilio?", null, ["Dónde se afilia."]),
    ).toEqual(["¿y dónde me afilio?", "Dónde se afilia."]);
    for (const steps of [undefined, null, []]) {
      expect(rerankQueries("¿y dónde me afilio?", null, steps)).toEqual([
        "¿y dónde me afilio?",
      ]);
    }
  });

  it("makes one call per sentence, in the same batch as the question's (#304)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "test-key");
    // Pinned: a shell that exported STEPS_RERANK=off would make this pass
    // on one call and prove nothing.
    vi.stubEnv("STEPS_RERANK", "pin");
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string).query);
      return new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 1 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    await rerankChunks("pregunta", [chunk(1)], {
      fetchImpl,
      steps: ["paso uno", "paso dos"],
    });
    expect(sent).toEqual(["pregunta", "paso uno", "paso dos"]);
  });

  it("sends each one to Voyage as its own query, over the same documents", async () => {
    const sent: string[] = [];
    const documentsSent: string[][] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      sent.push(body.query);
      // Collected, not asserted here: an assertion inside the mock throws
      // inside `scorePool`'s try/catch, which swallows it and returns null —
      // a dead assertion that passes on any value.
      documentsSent.push(body.documents);
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
    expect(documentsSent).toEqual([["contenido 1"], ["contenido 1"]]);
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

describe("the step catalogue at the rerank (#304)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Voyage, scripted per query: the question ranks c1 > c2 > c3, sentence
   * one ranks c3 best, sentence two ranks c2 best — a step chunk the cut
   * would drop, and one it already keeps.
   */
  function scripted(): typeof fetch {
    const verdicts: Record<
      string,
      { index: number; relevance_score: number }[]
    > = {
      pregunta: [
        { index: 0, relevance_score: 0.9 },
        { index: 1, relevance_score: 0.8 },
        { index: 2, relevance_score: 0.1 },
      ],
      "paso uno": [
        { index: 2, relevance_score: 0.95 },
        { index: 0, relevance_score: 0.2 },
      ],
      "paso dos": [
        { index: 1, relevance_score: 0.7 },
        { index: 2, relevance_score: 0.6 },
      ],
    };
    return (async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: verdicts[query] ?? [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
  }
  const pool = [chunk(1), chunk(2), chunk(3)];

  it("reads STEPS_RERANK, defaulting to the constant", () => {
    vi.stubEnv("STEPS_RERANK", "");
    expect(stepRerankMode()).toBe(STEP_RERANK_MODE);
    for (const mode of ["pin", "pin1", "max", "off"] as const) {
      vi.stubEnv("STEPS_RERANK", mode);
      expect(stepRerankMode()).toBe(mode);
    }
    vi.stubEnv("STEPS_RERANK", "sideways");
    expect(stepRerankMode()).toBe(STEP_RERANK_MODE);
  });

  it("pin: keeps the question's order and appends each sentence's best chunk past the cut", async () => {
    vi.stubEnv("STEPS_RERANK", "pin");
    vi.stubEnv("ANSWER_TOP_K", "2");
    const outcome = await rerankReadings("pregunta", pool, {
      fetchImpl: scripted(),
      steps: ["paso uno", "paso dos"],
    });
    // The order is the question's alone — c3 stays last despite 0.95.
    expect(outcome?.order.map((r) => r.chunk.chunkId)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    // One pick per sentence, scored by that sentence's reading, ranked by
    // the question's order.
    expect(
      outcome?.stepPicks.map((r) => [r.chunk.chunkId, r.score, r.rank]),
    ).toEqual([
      ["c3", 0.95, 3],
      ["c2", 0.7, 2],
    ]);
    // The cut is c1, c2; c3 is appended; c2 is already in and not repeated.
    expect(
      answerSetFromOrder(outcome!.order, pool, outcome!.stepPicks).map(
        (c) => c.chunkId,
      ),
    ).toEqual(["c1", "c2", "c3"]);
    expect(
      (
        await rerankChunks("pregunta", pool, {
          fetchImpl: scripted(),
          steps: ["paso uno", "paso dos"],
        })
      ).map((c) => c.chunkId),
    ).toEqual(["c1", "c2", "c3"]);
  });

  it("pin: never pins one chunk twice when two sentences agree", async () => {
    vi.stubEnv("STEPS_RERANK", "pin");
    vi.stubEnv("ANSWER_TOP_K", "1");
    const outcome = await rerankReadings("pregunta", pool, {
      fetchImpl: scripted(),
      steps: ["paso uno", "paso uno"],
    });
    expect(outcome?.stepPicks.map((r) => r.chunk.chunkId)).toEqual(["c3"]);
  });

  it("max: folds the sentences into the fused order and pins nothing", async () => {
    vi.stubEnv("STEPS_RERANK", "max");
    const outcome = await rerankReadings("pregunta", pool, {
      fetchImpl: scripted(),
      steps: ["paso uno", "paso dos"],
    });
    expect(outcome?.order.map((r) => r.chunk.chunkId)).toEqual([
      "c3",
      "c1",
      "c2",
    ]);
    expect(outcome?.stepPicks).toEqual([]);
  });

  it("off: does not score the sentences at all", async () => {
    vi.stubEnv("STEPS_RERANK", "off");
    const sent: string[] = [];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent.push(JSON.parse(init.body as string).query);
      return new Response(
        JSON.stringify({ data: [{ index: 0, relevance_score: 1 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const outcome = await rerankReadings("pregunta", pool, {
      fetchImpl,
      expansion: "términos oficiales",
      steps: ["paso uno", "paso dos"],
    });
    expect(sent).toEqual(["pregunta", "términos oficiales"]);
    expect(outcome?.stepPicks).toEqual([]);
  });

  it("pin: falls back to the sentence readings when the question's fail, and pins nothing", async () => {
    vi.stubEnv("STEPS_RERANK", "pin");
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string);
      if (query === "pregunta") return new Response("nope", { status: 500 });
      return new Response(
        JSON.stringify({ data: [{ index: 2, relevance_score: 0.95 }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const outcome = await rerankReadings("pregunta", pool, {
      fetchImpl,
      steps: ["paso uno"],
    });
    expect(outcome?.order.map((r) => r.chunk.chunkId)).toEqual(["c3"]);
    expect(outcome?.stepPicks).toEqual([]);
  });

  it("answerSetFromOrder appends picks after the per-document cap, each once", () => {
    vi.stubEnv("ANSWER_TOP_K", "2");
    const order = [chunk(1), chunk(2), chunk(3), chunk(4)].map((c, i) => ({
      chunk: c,
      score: 1 - i / 10,
      rank: i + 1,
    }));
    const picks = [order[3], order[0], order[3]];
    expect(answerSetFromOrder(order, [], picks).map((c) => c.chunkId)).toEqual([
      "c1",
      "c2",
      "c4",
    ]);
    // And with no rerank at all, the fused cut plus the picks.
    expect(
      answerSetFromOrder(
        null,
        order.map((r) => r.chunk),
        [order[2]],
      ).map((c) => c.chunkId),
    ).toEqual(["c1", "c2", "c3"]);
  });

  it("pin1: appends only the single best-scoring pick past the cut (#311)", async () => {
    vi.stubEnv("STEPS_RERANK", "pin1");
    vi.stubEnv("ANSWER_TOP_K", "1");
    const outcome = await rerankReadings("pregunta", pool, {
      fetchImpl: scripted(),
      steps: ["paso uno", "paso dos"],
    });
    // The same picks `pin` makes — one per sentence, the question's order
    // untouched — so the transcript still names every sentence's best chunk.
    expect(outcome?.order.map((r) => r.chunk.chunkId)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    expect(outcome?.stepPicks.map((r) => r.chunk.chunkId)).toEqual([
      "c3",
      "c2",
    ]);
    // The cut is c1; both picks are outside it, and only c3 (0.95 over
    // 0.7) is appended: the prompt grows by one fragment, not two.
    expect(
      answerSetFromOrder(outcome!.order, pool, outcome!.stepPicks).map(
        (c) => c.chunkId,
      ),
    ).toEqual(["c1", "c3"]);
    expect(
      (
        await rerankChunks("pregunta", pool, {
          fetchImpl: scripted(),
          steps: ["paso uno", "paso dos"],
        })
      ).map((c) => c.chunkId),
    ).toEqual(["c1", "c3"]);
  });

  it("pin1: a chunk two sentences share carries the higher of their scores", async () => {
    vi.stubEnv("STEPS_RERANK", "pin1");
    vi.stubEnv("ANSWER_TOP_K", "1");
    const verdicts: Record<
      string,
      { index: number; relevance_score: number }[]
    > = {
      pregunta: [{ index: 0, relevance_score: 0.9 }],
      "paso a": [{ index: 2, relevance_score: 0.5 }],
      "paso b": [{ index: 2, relevance_score: 0.95 }],
      "paso c": [{ index: 3, relevance_score: 0.8 }],
    };
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ data: verdicts[query] ?? [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const four = [chunk(1), chunk(2), chunk(3), chunk(4)];
    const outcome = await rerankReadings("pregunta", four, {
      fetchImpl,
      steps: ["paso a", "paso b", "paso c"],
    });
    // c3 keeps its first sentence's place but paso b's 0.95, so it — not
    // c4 at 0.8 — is the one append.
    expect(outcome?.stepPicks.map((r) => [r.chunk.chunkId, r.score])).toEqual([
      ["c3", 0.95],
      ["c4", 0.8],
    ]);
    expect(
      answerSetFromOrder(outcome!.order, four, outcome!.stepPicks).map(
        (c) => c.chunkId,
      ),
    ).toEqual(["c1", "c3"]);
  });

  it("pin1: the one pick is the best not already in the cut, by score and not sentence order", () => {
    vi.stubEnv("STEPS_RERANK", "pin1");
    vi.stubEnv("ANSWER_TOP_K", "2");
    const order = [chunk(1), chunk(2), chunk(3), chunk(4)].map((c, i) => ({
      chunk: c,
      score: 1 - i / 10,
      rank: i + 1,
    }));
    // c1 scores highest but the cut already holds it; of the two outside
    // it, c3 outscores c4 though its sentence came second.
    const picks = [
      { ...order[3], score: 0.5 },
      { ...order[0], score: 0.9 },
      { ...order[2], score: 0.8 },
    ];
    expect(answerSetFromOrder(order, [], picks).map((c) => c.chunkId)).toEqual([
      "c1",
      "c2",
      "c3",
    ]);
    // Every pick already in the cut: nothing is appended.
    expect(
      answerSetFromOrder(order, [], [picks[1]]).map((c) => c.chunkId),
    ).toEqual(["c1", "c2"]);
    // A tie keeps sentence order.
    expect(
      answerSetFromOrder(
        order,
        [],
        [
          { ...order[3], score: 0.8 },
          { ...order[2], score: 0.8 },
        ],
      ).map((c) => c.chunkId),
    ).toEqual(["c1", "c2", "c4"]);
    // Under `pin` the same picks all go in, in sentence order.
    vi.stubEnv("STEPS_RERANK", "pin");
    expect(answerSetFromOrder(order, [], picks).map((c) => c.chunkId)).toEqual([
      "c1",
      "c2",
      "c4",
      "c3",
    ]);
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

  it("keeps the surviving reading's own order when the question's call failed", () => {
    // The degradation policy promises "that reading alone", so its Voyage
    // order has to break the ties — not the pool position.
    expect(
      fuseByMaxScore([
        null,
        [
          { index: 1, score: 0.5 },
          { index: 0, score: 0.5 },
          { index: 2, score: 0.9 },
        ],
      ]).map((r) => r.index),
    ).toEqual([2, 1, 0]);
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

  it("drops a result Voyage could not have meant (CodeRabbit, #299)", async () => {
    vi.stubEnv("RERANK", "voyage");
    vi.stubEnv("VOYAGE_API_KEY", "vk-test");
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            { index: 0, relevance_score: 0.9 },
            // A string index passes a bare `chunks[index]` check and is a
            // different Map key from the number: left in, chunk 0 would enter
            // the order twice and push a real candidate out of the top-k.
            { index: "0", relevance_score: 0.8 },
            { index: 1.5, relevance_score: 0.7 },
            { index: -1, relevance_score: 0.7 },
            { index: 99, relevance_score: 0.7 },
            { index: 2, relevance_score: Number.NaN },
            { index: 1, relevance_score: 0.6 },
          ],
        }),
        { status: 200 },
      ),
    );
    const order = await rerankOrder("pregunta", POOL, { fetchImpl });
    expect(order?.map((r) => r.chunk.chunkId)).toEqual(["c1", "c2"]);
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

describe("the per-document cap (#303)", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** A chunk of document `doc`, ranked by its position in the list. */
  function of(doc: string, id: number): RetrievedChunk {
    return { ...chunk(id), docKey: doc };
  }
  const ranked = (chunks: RetrievedChunk[]): RerankedChunk[] =>
    chunks.map((c, i) => ({ chunk: c, score: 1 - i / 100, rank: i + 1 }));

  it("is off by default — measured on six cases and it earned no change", () => {
    expect(ANSWER_DOC_CAP).toBe(Infinity);
    // Stubbed before the first read: a shell that exports ANSWER_DOC_CAP for
    // a measured run must not leak into the test of the default.
    vi.stubEnv("ANSWER_DOC_CAP", "");
    expect(answerDocCap()).toBe(Infinity);
  });

  it("reads ANSWER_DOC_CAP from the environment; `off` is the default", () => {
    vi.stubEnv("ANSWER_DOC_CAP", "2");
    expect(answerDocCap()).toBe(2);
    vi.stubEnv("ANSWER_DOC_CAP", "off");
    expect(answerDocCap()).toBe(Infinity);
  });

  it("ignores a value that is not a positive integer", () => {
    for (const value of ["0", "-1", "1.5", "tres"]) {
      vi.stubEnv("ANSWER_DOC_CAP", value);
      expect(answerDocCap()).toBe(ANSWER_DOC_CAP);
    }
  });

  it("keeps no more than n chunks per docKey in the top-k when others are available", () => {
    // Five ccss-faq chunks in the top-8, the sixth document's chunk at #9 —
    // the ho-donde-me-afilio-caja shape from the six-case read.
    const order = ranked([
      of("ccss-faq", 1),
      of("ccss-faq", 2),
      of("ccss-reglamento-ti", 3),
      of("ccss-faq", 4),
      of("ccss-faq", 5),
      of("ccss-faq", 6),
      of("cnpt", 7),
      of("ley-renta", 8),
      of("ccss-prescripcion", 9),
      of("ley-iva", 10),
      of("ccss-faq", 11),
    ]);
    const cut = capPerDocument(order, 8, 3).map(({ chunk }) => chunk.chunkId);
    // c5, c6 and c11 are ccss-faq's fourth, fifth and sixth; c9 and c10 —
    // other documents, ranked below them — take the places they would have.
    expect(cut).toEqual(["c1", "c2", "c3", "c4", "c7", "c8", "c9", "c10"]);
  });

  it("keeps the reranked order among the survivors — the cap drops, never reorders", () => {
    const order = ranked([
      of("a", 1),
      of("a", 2),
      of("a", 3),
      of("a", 4),
      of("b", 5),
    ]);
    const cut = capPerDocument(order, 3, 2).map(({ chunk }) => chunk.chunkId);
    expect(cut).toEqual(["c1", "c2", "c5"]);
  });

  it("backfills with the capped document's own chunks when no other document can fill the set", () => {
    // One long artículo split in parts, and nothing else in the pool: the
    // cap must not leave the answer set short.
    const order = ranked([of("a", 1), of("a", 2), of("a", 3), of("a", 4)]);
    const cut = capPerDocument(order, 3, 2).map(({ chunk }) => chunk.chunkId);
    expect(cut).toEqual(["c1", "c2", "c3"]);
  });

  it("backfills in rank order, across documents", () => {
    const order = ranked([
      of("a", 1),
      of("a", 2),
      of("b", 3),
      of("b", 4),
      of("a", 5),
      of("b", 6),
    ]);
    // Cap 1 keeps c1 and c3; two more places go to the next-ranked deferred
    // chunks, c2 then c4 — not to a's second before b's second by document.
    const cut = capPerDocument(order, 4, 1).map(({ chunk }) => chunk.chunkId);
    expect(cut).toEqual(["c1", "c3", "c2", "c4"]);
  });

  it("is the identity below the cap", () => {
    const order = ranked([of("a", 1), of("b", 2), of("a", 3)]);
    expect(capPerDocument(order, 8, 3)).toEqual(order);
  });

  it("applies to the reranked answer set through answerSetFromOrder when set", () => {
    const order = ranked([
      of("a", 1),
      of("a", 2),
      of("a", 3),
      of("a", 4),
      of("b", 5),
    ]);
    vi.stubEnv("ANSWER_TOP_K", "4");
    expect(
      answerSetFromOrder(
        order,
        order.map(({ chunk }) => chunk),
      ).map((c) => c.chunkId),
    ).toEqual(["c1", "c2", "c3", "c4"]);
    vi.stubEnv("ANSWER_DOC_CAP", "3");
    expect(
      answerSetFromOrder(
        order,
        order.map(({ chunk }) => chunk),
      ).map((c) => c.chunkId),
    ).toEqual(["c1", "c2", "c3", "c5"]);
  });

  it("applies to the fused fallback too — the cut is one place, whichever order it cuts", () => {
    vi.stubEnv("ANSWER_TOP_K", "4");
    vi.stubEnv("ANSWER_DOC_CAP", "3");
    const fused = [of("a", 1), of("a", 2), of("a", 3), of("a", 4), of("b", 5)];
    expect(answerSetFromOrder(null, fused).map((c) => c.chunkId)).toEqual([
      "c1",
      "c2",
      "c3",
      "c5",
    ]);
  });
});
