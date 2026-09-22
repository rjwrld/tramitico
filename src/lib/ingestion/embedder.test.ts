import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearQueryCache,
  createEmbedder,
  INTERACTIVE_EMBED_TIMEOUT_MS,
  QUERY_CACHE_TTL_MS,
  queryCacheKeys,
} from "./embedder";
import { EMBEDDING_DIMENSIONS } from "../embedding-dimensions";

/**
 * Fake embeddings endpoint: embeds each input text as a one-dimensional
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

/**
 * A provider that accepts the request and never answers — the outage the
 * interactive budget exists for. It rejects only when the signal fires, so a
 * test that gets a rejection out of it proves the abort did the work.
 */
function hangingFetch() {
  return vi.fn(
    (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject(init.signal?.reason as Error),
        );
      }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** Fetch that answers 200 with `payload`, whatever shape that is. */
function respondingWith(payload: unknown) {
  return vi.fn(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
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
    // The memo is module-scoped by design (#380 documents it below); a case
    // that asserts a fetch count must not inherit another case's entries.
    clearQueryCache();
  });

  it("defaults to stub when EMBEDDINGS_PROVIDER is unset", () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", undefined as unknown as string);
    expect(createEmbedder().provider).toBe("stub");
  });

  it('defaults to stub when EMBEDDINGS_PROVIDER is empty — CI interpolates unset vars as ""', () => {
    vi.stubEnv("EMBEDDINGS_PROVIDER", "");
    expect(createEmbedder().provider).toBe("stub");
  });

  /**
   * The stub is only usable if the schema can hold and compare what it emits
   * (#193): a narrower vector is rejected by `chunks.embedding` on write and
   * errors inside `search_chunks` on read.
   */
  describe("stub", () => {
    it("emits vectors of the schema's pinned width", () => {
      expect(createEmbedder("stub").dimensions).toBe(EMBEDDING_DIMENSIONS);
    });

    it("returns that many components per text, document and query alike", async () => {
      const embedder = createEmbedder("stub");
      const [document] = await embedder.embed(["El IVA es del 13%."]);
      const query = await embedder.embedQuery("¿cuánto es el IVA?");
      expect(document).toHaveLength(EMBEDDING_DIMENSIONS);
      expect(query).toHaveLength(EMBEDDING_DIMENSIONS);
    });
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

  /**
   * A 200 that carries no usable vector used to become `undefined` typed as
   * `number[]`, cached and returned (#206) — the #127 contract says a provider
   * that cannot answer must fail at the call site so retrieval can degrade,
   * not hand back a hole that fails somewhere unrecognisable later.
   */
  describe("malformed 200 responses", () => {
    it("throws when the response carries fewer vectors than inputs", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const fetchImpl = respondingWith({ data: [{ embedding: [1] }] });
      const embedder = createEmbedder("voyage", { fetchImpl });
      await expect(embedder.embed(["uno", "dos"])).rejects.toThrow(
        "Voyage embeddings: expected 2 vectors, got 1",
      );
    });

    it("throws on an empty data array instead of yielding undefined", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const fetchImpl = respondingWith({ data: [] });
      const embedder = createEmbedder("voyage", { fetchImpl });
      await expect(
        embedder.embedQuery("consulta sin respuesta"),
      ).rejects.toThrow("Voyage embeddings: expected 1 vectors, got 0");
    });

    it("throws on an empty or non-numeric vector", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      for (const payload of [
        { data: [{ embedding: [] }] },
        { data: [{ embedding: null }] },
        { data: [{ embedding: ["0.1"] }] },
        { data: [{}] },
      ]) {
        const embedder = createEmbedder("voyage", {
          fetchImpl: respondingWith(payload),
        });
        await expect(embedder.embed(["uno"])).rejects.toThrow(
          "Voyage embeddings: response carried a malformed vector",
        );
      }
    });

    it("caches nothing it rejected — a later good response is fetched, not served stale", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const question = "consulta que primero falla";
      const broken = createEmbedder("voyage", {
        fetchImpl: respondingWith({ data: [] }),
      });
      await expect(broken.embedQuery(question)).rejects.toThrow();

      const fetchImpl = fakeEmbeddingsFetch();
      const healthy = createEmbedder("voyage", { fetchImpl });
      expect(await healthy.embedQuery(question)).toEqual([
        question.charCodeAt(0),
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The provider list is a privacy contract, not a convenience (#209): a
   * provider wired here is selectable from a hosting dashboard with no PR and
   * no deploy, so anything not named on /privacidad must not be reachable.
   * The openai adapter was removed for exactly that reason; these cases pin
   * the closed door.
   */
  describe("removed and unknown providers", () => {
    it.each(["openai", "cohere", "OPENAI", "voyage-3"])(
      "throws on EMBEDDINGS_PROVIDER=%s instead of reaching a provider",
      (provider) => {
        vi.stubEnv("OPENAI_API_KEY", "sk-test");
        const fetchImpl = fakeEmbeddingsFetch();
        expect(() => createEmbedder(provider, { fetchImpl })).toThrow(
          `Unknown EMBEDDINGS_PROVIDER: ${provider}`,
        );
        expect(fetchImpl).not.toHaveBeenCalled();
      },
    );

    it("throws on an unknown provider taken from the environment", () => {
      vi.stubEnv("EMBEDDINGS_PROVIDER", "openai");
      expect(() => createEmbedder()).toThrow(
        "Unknown EMBEDDINGS_PROVIDER: openai",
      );
    });
  });

  /**
   * The interactive policy (#127 req. 1). What is under test is the *shape* of
   * the attempt — one request, aborted on a budget — not the wall-clock 5 s
   * itself, so the budget is shortened per case; the default is pinned
   * separately as a constant.
   */
  describe("embedQuery (interactive policy)", () => {
    it("budgets an interactive embed at ~5s by default", () => {
      expect(INTERACTIVE_EMBED_TIMEOUT_MS).toBe(5_000);
    });

    it("stub embeds a query exactly as it embeds a document", async () => {
      const embedder = createEmbedder("stub");
      const [viaEmbed] = await embedder.embed(["¿cuánto es el IVA?"]);
      expect(await embedder.embedQuery("¿cuánto es el IVA?")).toEqual(viaEmbed);
    });

    it("aborts a hung provider inside the budget instead of hanging the ask", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const fetchImpl = hangingFetch();
      const embedder = createEmbedder("voyage", {
        fetchImpl,
        queryTimeoutMs: 25,
      });
      const started = Date.now();
      const rejection = await embedder
        .embedQuery("consulta que nadie responde")
        .then(
          () => null,
          (error: unknown) => error,
        );
      // The budget is what ended it, and it ended on the budget's own clock —
      // the generous ceiling is there to catch "waited for something else"
      // (an ingestion-style 30 s sleep), not to time the timer.
      expect((rejection as Error).name).toMatch(/TimeoutError|AbortError/);
      expect(Date.now() - started).toBeLessThan(2_000);
      // Single attempt: no retry loop behind the abort.
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("passes an abort signal the provider call can see", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const fetchImpl = hangingFetch();
      const embedder = createEmbedder("voyage", {
        fetchImpl,
        queryTimeoutMs: 25,
      });
      await expect(
        embedder.embedQuery("otra consulta colgada"),
      ).rejects.toThrow();
      const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.signal?.aborted).toBe(true);
    });

    it("does not retry a 429 the way the ingestion path does", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(response429("30")) as unknown as typeof fetch &
        ReturnType<typeof vi.fn>;
      const embedder = createEmbedder("voyage", { fetchImpl });
      // Ingestion would sleep ≥30 s and try again (up to 60 times); the ask
      // path gets the failure back immediately and degrades instead.
      await expect(embedder.embedQuery("consulta con 429")).rejects.toThrow(
        "Voyage embeddings: HTTP 429",
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("serves a repeat of the same question from the query cache", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const fetchImpl = fakeEmbeddingsFetch();
      const embedder = createEmbedder("voyage", { fetchImpl });
      const first = await embedder.embedQuery("Consulta memorizada");
      expect(await embedder.embedQuery("Consulta memorizada")).toEqual(first);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The memo's retention shape (#380). It is module-wide on purpose — every
   * request in a process shares it, which is what makes the 3/min rationale
   * hold across lambdas' warm invocations — so what these cases pin is the
   * two limits on that: nothing in it is the question, and nothing in it
   * outlives the TTL.
   */
  describe("query cache retention (#380)", () => {
    it("is shared by independent embedder instances", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const first = createEmbedder("voyage", {
        fetchImpl: fakeEmbeddingsFetch(),
      });
      const secondFetch = fakeEmbeddingsFetch();
      const second = createEmbedder("voyage", { fetchImpl: secondFetch });
      const vector = await first.embedQuery("Pregunta compartida");
      expect(await second.embedQuery("Pregunta compartida")).toEqual(vector);
      expect(secondFetch).not.toHaveBeenCalled();
    });

    it("re-fetches a repeat once the TTL has passed", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-21T12:00:00Z"));
      const fetchImpl = fakeEmbeddingsFetch();
      const embedder = createEmbedder("voyage", { fetchImpl });
      await embedder.embedQuery("Pregunta que caduca");
      // Inside the window: still the memo.
      vi.setSystemTime(Date.now() + QUERY_CACHE_TTL_MS - 1);
      await embedder.embedQuery("Pregunta que caduca");
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      // At the window's edge: expired, so the provider is asked again.
      vi.setSystemTime(Date.now() + 1);
      await embedder.embedQuery("Pregunta que caduca");
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(queryCacheKeys()).toHaveLength(1);
    });

    it("keeps no question text as a key", async () => {
      vi.stubEnv("VOYAGE_API_KEY", "vk-test");
      const embedder = createEmbedder("voyage", {
        fetchImpl: fakeEmbeddingsFetch(),
      });
      const questions = [
        "¿Cuánto es el IVA para un desarrollador independiente?",
        "Cómo me inscribo en la CCSS",
      ];
      for (const q of questions) {
        await embedder.embedQuery(q);
        await embedder.embed([q]);
      }
      const keys = queryCacheKeys();
      expect(keys).toHaveLength(questions.length);
      for (const key of keys) {
        expect(key).toMatch(/^voyage::[0-9a-f]{64}$/);
        for (const q of questions) expect(key).not.toContain(q);
      }
    });
  });
});
