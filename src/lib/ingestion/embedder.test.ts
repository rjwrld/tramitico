import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbedder } from "./embedder";

/**
 * Fake Voyage/OpenAI endpoint: embeds each input text as a one-dimensional
 * vector holding its first char code, so tests can assert both batching
 * (call count / batch sizes) and that vector order matches input order.
 */
function fakeEmbeddingsFetch() {
  return vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(init?.body as string) as { input: string[] };
    return new Response(
      JSON.stringify({
        data: body.input.map((text) => ({ embedding: [text.charCodeAt(0)] })),
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

function response429(retryAfter?: string) {
  return new Response("rate limited", {
    status: 429,
    headers: retryAfter ? { "retry-after": retryAfter } : {},
  });
}

/** Fetch that 429s once, then behaves like the fake embeddings endpoint. */
function fetchFailingOnceWith(first: Response) {
  return vi
    .fn()
    .mockResolvedValueOnce(first)
    .mockImplementation(fakeEmbeddingsFetch()) as unknown as typeof fetch;
}

function batchSizesFromCalls(fetchImpl: ReturnType<typeof vi.fn>) {
  return fetchImpl.mock.calls.map(
    (call) =>
      (
        JSON.parse((call[1] as RequestInit).body as string) as {
          input: string[];
        }
      ).input.length,
  );
}

describe("createEmbedder", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("defaults to stub when EMBEDDINGS_PROVIDER is unset", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", undefined as unknown as string);
    expect(createEmbedder().provider).toBe("stub");
  });

  it('defaults to stub when EMBEDDINGS_PROVIDER is empty — CI interpolates unset vars as ""', () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "");
    expect(createEmbedder().provider).toBe("stub");
  });

  it("rejects an unknown provider", () => {
    expect(() => createEmbedder("no-such-provider")).toThrow(
      /Unknown EMBEDDINGS_PROVIDER/,
    );
  });

  describe("voyage", () => {
    function voyageEmbedder(fetchImpl: typeof fetch) {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      return createEmbedder("voyage", { fetchImpl });
    }

    it("retries a 429 and succeeds, waiting the 30s floor when Retry-After is absent", async () => {
      vi.useFakeTimers();
      const fetchImpl = fetchFailingOnceWith(response429());
      const embedder = voyageEmbedder(fetchImpl);

      const pending = embedder.embed(["Retry once"]);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual([["R".charCodeAt(0)]]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("waits the full Retry-After when the header exceeds the 30s floor", async () => {
      vi.useFakeTimers();
      const fetchImpl = fetchFailingOnceWith(response429("45"));
      const embedder = voyageEmbedder(fetchImpl);

      const pending = embedder.embed(["Slow retry"]);
      await vi.advanceTimersByTimeAsync(44_999);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await expect(pending).resolves.toEqual([["S".charCodeAt(0)]]);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });

    it("flips to adaptive pacing after the first 429: next request waits the 21s gap", async () => {
      vi.useFakeTimers();
      const fetchImpl = fetchFailingOnceWith(response429());
      const embedder = voyageEmbedder(fetchImpl);

      const first = embedder.embed(["pace primer"]);
      await vi.advanceTimersByTimeAsync(30_000);
      await first;
      expect(fetchImpl).toHaveBeenCalledTimes(2);

      // Immediately after the successful retry, a new embed must hold the
      // 21s minimum gap before hitting the API again.
      const second = embedder.embed(["pace follow-up"]);
      await vi.advanceTimersByTimeAsync(20_999);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await expect(second).resolves.toEqual([["p".charCodeAt(0)]]);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
    });

    it("throws on a non-retryable status", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          new Response("bad request", { status: 400 }),
        ) as unknown as typeof fetch;
      const embedder = voyageEmbedder(fetchImpl);
      await expect(embedder.embed(["Bad batch"])).rejects.toThrow(
        "Voyage embeddings: HTTP 400",
      );
    });

    it("splits multi-text embeds at 12 texts per request, preserving order", async () => {
      const fetchImpl = fakeEmbeddingsFetch();
      const embedder = voyageEmbedder(fetchImpl);
      // 30 short texts, distinct first chars "A".."^" — well under the token
      // budget, so only MAX_BATCH (12) forces the splits: 12 + 12 + 6.
      const texts = Array.from(
        { length: 30 },
        (_, i) => String.fromCharCode(65 + i) + " corto",
      );
      const vectors = await embedder.embed(texts);
      expect(fetchImpl).toHaveBeenCalledTimes(3);
      const batchSizes = batchSizesFromCalls(fetchImpl);
      expect(batchSizes).toEqual([12, 12, 6]);
      expect(vectors).toEqual(texts.map((t) => [t.charCodeAt(0)]));
    });

    it("splits batches so no request exceeds the ~8K estimated-token budget", async () => {
      const fetchImpl = fakeEmbeddingsFetch();
      const embedder = voyageEmbedder(fetchImpl);
      // Each text ≈ 3000 estimated tokens (10500 chars / 3.5). Two fit within
      // the 8000 budget; a third would blow it, so: [t1, t2], [t3].
      const texts = ["X", "Y", "Z"].map((c) => c + "x".repeat(10_499));
      const vectors = await embedder.embed(texts);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      const batchSizes = batchSizesFromCalls(fetchImpl);
      expect(batchSizes).toEqual([2, 1]);
      expect(vectors).toEqual(texts.map((t) => [t.charCodeAt(0)]));
    });

    it("serves a repeated single-text embed from the query cache with zero fetches", async () => {
      const fetchImpl = fakeEmbeddingsFetch();
      const embedder = voyageEmbedder(fetchImpl);
      const first = await embedder.embed(["misma consulta"]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const second = await embedder.embed(["misma consulta"]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      expect(second).toEqual(first);
    });
  });

  describe("openai", () => {
    it("embeds via the injected fetch and returns vectors in order", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      const fetchImpl = fakeEmbeddingsFetch();
      const embedder = createEmbedder("openai", { fetchImpl });
      const vectors = await embedder.embed(["Alpha", "Beta"]);
      expect(vectors).toEqual([["A".charCodeAt(0)], ["B".charCodeAt(0)]]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(url).toContain("openai.com");
      expect((JSON.parse(init.body as string) as { model: string }).model).toBe(
        "text-embedding-3-small",
      );
    });

    it("throws on a non-OK response", async () => {
      vi.stubEnv("OPENAI_API_KEY", "sk-test");
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(
          new Response("nope", { status: 500 }),
        ) as unknown as typeof fetch;
      const embedder = createEmbedder("openai", { fetchImpl });
      await expect(embedder.embed(["Gamma"])).rejects.toThrow(
        "OpenAI embeddings: HTTP 500",
      );
    });
  });
});
