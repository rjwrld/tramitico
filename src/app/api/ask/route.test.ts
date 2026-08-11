import { simulateReadableStream } from "ai";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RetrievalResult, RetrievedChunk } from "@/lib/retrieval";
import { POST } from "./route";

vi.mock("@/lib/retrieval", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/retrieval")>()),
  retrieve: vi.fn(),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/rate-limit")>()),
  checkRateLimit: vi.fn(),
}));
vi.mock("@/lib/answer/model", () => ({ getAnswerModel: vi.fn() }));
vi.mock("@/lib/answer/user", () => ({ getUserId: vi.fn() }));
vi.mock("@/lib/answer/persist", () => ({ saveQuestion: vi.fn() }));

import {
  ASK_FALLBACK_ERROR_MESSAGE,
  askErrorMessage,
} from "@/lib/answer/contract";
import { saveQuestion } from "@/lib/answer/persist";
import { getAnswerModel } from "@/lib/answer/model";
import { getUserId } from "@/lib/answer/user";
import { checkRateLimit } from "@/lib/rate-limit";
import { retrieve } from "@/lib/retrieval";

function chunk(
  id: number,
  overrides: Partial<RetrievedChunk> = {},
): RetrievedChunk {
  return {
    chunkId: `c${id}`,
    docKey: `doc-${id}`,
    docTitle: `Documento ${id}`,
    norma: null,
    articulo: `Artículo ${id}`,
    path: [],
    part: 0,
    content: `contenido ${id}`,
    source: { url: `https://example.go.cr/${id}` },
    score: 1 / (60 + id),
    vectorRank: id,
    lexicalRank: id,
    ...overrides,
  };
}

function retrievalResult(
  overrides: Partial<RetrievalResult> = {},
): RetrievalResult {
  const chunks = [chunk(1), chunk(2)];
  return {
    query: "¿Cuánto es el IVA?",
    chunks,
    citations: [],
    topScore: chunks[0].score,
    isWeak: false,
    ...overrides,
  };
}

function allowRateLimit(): void {
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: new Date(),
    reason: "ok",
    message: null,
  });
}

/**
 * Mock the model's stream. `deltas` defaults to one word each; pass it
 * explicitly to simulate the provider's real bursts (several words per delta,
 * markers split mid-token) — that is what #73's smoothStream re-chunks.
 * `chunkDelayInMs` (#74) spaces the deltas out in real time so a test can
 * abort deterministically after the first one has already reached the wire,
 * instead of the whole answer landing in a single microtask.
 *
 * Returns the model so a test can inspect `doStreamCalls` — the SDK forwards
 * whatever `abortSignal` `streamText` was given straight through to the
 * provider call, which is exactly the wiring #74/F-11 adds.
 */
function mockModel(
  text: string,
  deltas: readonly string[] = text.split(" ").map((word) => `${word} `),
  chunkDelayInMs = 0,
): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doStream: {
      stream: simulateReadableStream<LanguageModelV4StreamPart>({
        chunkDelayInMs,
        chunks: [
          { type: "stream-start", warnings: [] },
          { type: "text-start", id: "t1" },
          ...deltas.map((delta): LanguageModelV4StreamPart => ({
            type: "text-delta",
            id: "t1",
            delta,
          })),
          { type: "text-end", id: "t1" },
          {
            type: "finish",
            finishReason: { unified: "stop" as const, raw: "end_turn" },
            usage: {
              inputTokens: {
                total: 1,
                noCache: 1,
                cacheRead: 0,
                cacheWrite: 0,
              },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
          },
        ],
      }),
    },
  });
  vi.mocked(getAnswerModel).mockReturnValue(model);
  return model;
}

/**
 * A model that dies partway through: some text lands, then the provider
 * errors. This is the shape a real mid-stream outage takes — the request is
 * long past its 200, so nothing but the stream can carry the failure.
 */
function mockFailingModel(text: string): void {
  vi.mocked(getAnswerModel).mockReturnValue(
    new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream<LanguageModelV4StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            { type: "text-delta", id: "t1", delta: text },
            { type: "error", error: new Error("provider exploded") },
          ],
        }),
      },
    }),
  );
}

function askRequest(body: unknown, signal?: AbortSignal): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

interface SseEvent {
  type: string;
  delta?: string;
  data?: unknown;
  errorText?: string;
}

function parseSseEvents(text: string): SseEvent[] {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice("data: ".length)) as SseEvent);
}

async function readEvents(response: Response): Promise<SseEvent[]> {
  const text = await new Response(response.body).text();
  return parseSseEvents(text);
}

/**
 * Reads the response manually up through the first `text-delta` — proof the
 * mocked provider call actually started — then aborts `controller` and
 * drains the rest so the route's `execute` (and its `onFinish`/persistence)
 * gets to run to completion. `chunkDelayInMs` on the mocked model (#74) is
 * what makes "abort after the first delta, mid-stream" land deterministically
 * rather than racing the whole answer landing in one microtask.
 */
async function readUntilTextDeltaThenAbort(
  response: Response,
  controller: AbortController,
): Promise<SseEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!buffer.includes('"type":"text-delta"')) {
    const { done, value } = await reader.read();
    if (done) throw new Error("stream ended before any text arrived");
    buffer += decoder.decode(value, { stream: true });
  }
  controller.abort();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  buffer += decoder.decode();
  return parseSseEvents(buffer);
}

function textDeltas(events: SseEvent[]): string[] {
  return events
    .filter((e) => e.type === "text-delta")
    .map((e) => e.delta ?? "");
}

function streamedText(events: SseEvent[]): string {
  return textDeltas(events).join("");
}

/** Stage of each `data-status` part, in the order the stream carried them. */
function stages(events: SseEvent[]): string[] {
  return events
    .filter((e) => e.type === "data-status")
    .map((e) => (e.data as { stage: string }).stage);
}

/**
 * The user-facing Spanish behind an `error` part. The client reaches it via
 * `askErrorMessage` on the Error the transport throws; here we read the same
 * envelope straight off the wire.
 */
function errorMessages(events: SseEvent[]): string[] {
  return events
    .filter((e) => e.type === "error")
    .map((e) => askErrorMessage(new Error(e.errorText ?? "")));
}

/**
 * Types of the parts this contract pins, in stream order — the noise
 * (`start-step`, `finish-step`) is the SDK's, not ours to assert.
 */
function contractOrder(events: SseEvent[]): string[] {
  return events
    .map((e) => e.type)
    .filter((type) =>
      [
        "start",
        "data-status",
        "text-delta",
        "data-citations",
        "finish",
      ].includes(type),
    );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserId).mockResolvedValue(null);
  vi.unstubAllEnvs();
  // Reranking defaults on since #25; keep these tests hermetic — a
  // VOYAGE_API_KEY in the developer's shell must not trigger real calls.
  vi.stubEnv("RERANK", "off");
});

describe("POST /api/ask", () => {
  it("streams the answer with citations delivered as data parts in order of use", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    const answer =
      "La tarifa es 13% [2]. Aplica a servicios [1] y también [2].";
    mockModel(answer);

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(200);
    const events = await readEvents(response);

    // Full equality, not `toContain`: smoothStream (#73) re-chunks the deltas,
    // so this is the guard that nothing is dropped or reordered on the way out
    // (mockModel appends a trailing space to every word).
    expect(streamedText(events)).toBe(`${answer} `);
    const citationEvents = events.filter((e) => e.type === "data-citations");
    expect(citationEvents.length).toBeGreaterThan(0);
    const final = citationEvents.at(-1)!.data as { docKey: string }[];
    expect(final.map((c) => c.docKey)).toEqual(["doc-2", "doc-1"]);
    // Retrieval fetched the rerank pool, not just top-8.
    expect(vi.mocked(retrieve)).toHaveBeenCalledWith("¿Cuánto es el IVA?", {
      matchCount: 40,
    });
  });

  it("re-chunks the model's bursty deltas into one word per event (#73)", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    // How the provider actually delivers: multi-word bursts, and a marker
    // split across three deltas.
    const bursts = [
      "La tarifa es 13% [",
      "2",
      "]. Aplica a servicios [1]",
      " y también [2].",
    ];
    mockModel(bursts.join(""), bursts);

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    const events = await readEvents(response);
    const deltas = textDeltas(events);

    // Nothing added, dropped, or reordered — only the boundaries moved.
    expect(deltas.join("")).toBe(bursts.join(""));
    expect(deltas.length).toBeGreaterThan(bursts.length);
    // Each event carries at most one word, so the client paints word by word.
    for (const delta of deltas) {
      expect(delta.trim().split(/\s+/).filter(Boolean)).toHaveLength(1);
    }
    // Word boundaries re-aggregate the split marker rather than splitting it
    // further — the citation tracker sees "[2]" whole.
    expect(deltas).toContain("[2]. ");
    const final = events.filter((e) => e.type === "data-citations").at(-1)!
      .data as { docKey: string }[];
    expect(final.map((c) => c.docKey)).toEqual(["doc-2", "doc-1"]);
  });

  it("streams the honest fallback with zero citations on weak retrieval, without calling the model", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(
      retrievalResult({ chunks: [], topScore: 0, isWeak: true }),
    );

    const response = await POST(askRequest({ question: "asdf qwerty zzz" }));
    expect(response.status).toBe(200);
    const events = await readEvents(response);

    expect(streamedText(events)).toContain("No encuentro base oficial");
    expect(events.filter((e) => e.type === "data-citations")).toHaveLength(0);
    expect(vi.mocked(getAnswerModel)).not.toHaveBeenCalled();
    // Straight from buscando to the canned text — nothing is being redactado.
    expect(stages(events)).toEqual(["buscando"]);
  });

  it("returns 429 with the friendly ES limit message when rate limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      reason: "rate_limited",
      message: "Alcanzó el límite de 10 preguntas gratis por hoy.",
    });

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(429);
    // The client contract (contract.ts) reads `message` for the user-facing
    // copy; `error` is a stable machine code.
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limited");
    expect(body.message).toContain("límite de 10 preguntas");
    expect(vi.mocked(retrieve)).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the rate limiter is unavailable", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      reason: "unavailable",
      message: "No pudimos verificar su límite de preguntas en este momento.",
    });

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limit_unavailable");
    expect(body.message).toContain("verificar su límite");
    expect(vi.mocked(retrieve)).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty question with a 400 and an ES message", async () => {
    for (const body of [{}, { question: "  " }, { question: 42 }]) {
      const response = await POST(askRequest(body));
      expect(response.status).toBe(400);
      const parsed = (await response.json()) as {
        error: string;
        message: string;
      };
      expect(parsed.error).toBe("invalid_question");
      expect(parsed.message).toMatch(/pregunta/i);
    }
    expect(vi.mocked(checkRateLimit)).not.toHaveBeenCalled();
  });

  it("uses the authed tier and persists question/answer/citations for signed-in users", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-123");
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockModel("Aplica el 13% [1].");

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    await readEvents(response);

    expect(vi.mocked(checkRateLimit)).toHaveBeenCalledWith(
      "user:user-123",
      "authed",
    );
    expect(vi.mocked(saveQuestion)).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveQuestion).mock.calls[0][0];
    expect(saved.userId).toBe("user-123");
    expect(saved.question).toBe("¿Cuánto es el IVA?");
    expect(saved.answer).toContain("13%");
    expect(saved.citations.map((c) => c.docKey)).toEqual(["doc-1"]);
  });

  it("persists the honest fallback for signed-in users on weak retrieval", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-123");
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(
      retrievalResult({ chunks: [], topScore: 0, isWeak: true }),
    );

    const response = await POST(askRequest({ question: "asdf qwerty zzz" }));
    await readEvents(response);

    expect(vi.mocked(saveQuestion)).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveQuestion).mock.calls[0][0];
    expect(saved.answer).toContain("No encuentro base oficial");
    expect(saved.citations).toEqual([]);
  });

  it("keeps a persistence failure out of the weak-retrieval answer", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-123");
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(
      retrievalResult({ chunks: [], topScore: 0, isWeak: true }),
    );
    vi.mocked(saveQuestion).mockRejectedValue(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(askRequest({ question: "asdf qwerty zzz" }));
    const events = await readEvents(response);

    // persist.ts: failures are "logged, never surfaced — the user already has
    // their answer". Moving the save inside `execute` (#71) must not change
    // that into an error part stamped under a delivered answer.
    expect(errorMessages(events)).toEqual([]);
    expect(streamedText(events)).toContain("No encuentro base oficial");
    spy.mockRestore();
  });

  it("does not persist anything for anonymous users", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockModel("Aplica el 13% [1].");

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    await readEvents(response);
    expect(vi.mocked(saveQuestion)).not.toHaveBeenCalled();
  });

  it("reports buscando then redactando before the answer text (#71)", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockModel("Aplica el 13% [1].");

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    const events = await readEvents(response);

    expect(stages(events)).toEqual(["buscando", "redactando"]);
    // Both stages are snapshots on one part, so a client that renders the
    // latest can never stack them (ADR 0004's idempotency rule).
    const ids = events
      .filter((e) => e.type === "data-status")
      .map((e) => (e as { id?: string }).id);
    expect(ids).toEqual(["status", "status"]);

    const order = contractOrder(events);
    expect(order[0]).toBe("start");
    expect(order.slice(1, 3)).toEqual(["data-status", "data-status"]);
    expect(order.indexOf("text-delta")).toBeGreaterThan(2);
    expect(order.indexOf("data-citations")).toBeGreaterThan(
      order.indexOf("text-delta"),
    );
    expect(order.at(-1)).toBe("finish");
    // Exactly one `start` — the merged model stream must not add a second.
    expect(order.filter((type) => type === "start")).toHaveLength(1);
  });

  it("opens the stream before retrieval runs (#71)", async () => {
    allowRateLimit();
    let releaseRetrieval!: (result: RetrievalResult) => void;
    vi.mocked(retrieve).mockReturnValue(
      new Promise<RetrievalResult>((resolve) => {
        releaseRetrieval = resolve;
      }),
    );
    mockModel("Aplica el 13% [1].");

    // The response resolves while retrieval is still pending — that is the
    // whole point of the issue: TTFB stops waiting on embed+search+rerank.
    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(200);

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("start");

    releaseRetrieval(retrievalResult());
    await reader.cancel();
  });

  it("surfaces retrieval failure as an ES error part inside the 200 stream", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    // The stream already opened, so this can no longer be a 502.
    expect(response.status).toBe(200);
    const events = await readEvents(response);

    expect(stages(events)).toEqual(["buscando"]);
    expect(errorMessages(events)).toEqual([
      "No se pudo buscar en los documentos oficiales. Intente de nuevo en unos minutos.",
    ]);
    expect(streamedText(events)).toBe("");
    spy.mockRestore();
  });

  it("maps a mid-stream model failure to the contract's ES copy (F-22)", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockFailingModel("La tarifa es ");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    const events = await readEvents(response);

    // What the client renders — not the SDK's English "An error occurred.",
    // and not the provider's raw reason.
    expect(errorMessages(events)).toEqual([ASK_FALLBACK_ERROR_MESSAGE]);
    expect(events.some((e) => e.errorText?.includes("provider exploded"))).toBe(
      false,
    );
    // The text that did arrive is kept — a partial answer beats a blank.
    expect(streamedText(events)).toContain("La tarifa es");
    spy.mockRestore();
  });

  it("maps a throw inside execute to the contract's ES copy (F-22)", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    // The other door into a mid-stream failure: not an error part on the
    // model's stream but a throw in `execute` itself (a missing key here),
    // which only `createUIMessageStream`'s own `onError` catches.
    vi.mocked(getAnswerModel).mockImplementation(() => {
      throw new Error("ANTHROPIC_API_KEY is not set");
    });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(200);
    const events = await readEvents(response);

    expect(errorMessages(events)).toEqual([ASK_FALLBACK_ERROR_MESSAGE]);
    expect(events.some((e) => e.errorText?.includes("ANTHROPIC"))).toBe(false);
    spy.mockRestore();
  });

  // #74/F-11: the client's abort must reach the paid provider call, not just
  // stop the client from reading further.
  it("propagates the client's abort into streamText so the provider call is cancelled (#74, F-11)", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    const model = mockModel("La tarifa es 13% para servicios.", undefined, 25);

    const controller = new AbortController();
    const response = await POST(
      askRequest({ question: "¿Cuánto es el IVA?" }, controller.signal),
    );

    await readUntilTextDeltaThenAbort(response, controller);

    // `streamText` forwards whatever `abortSignal` it was given straight
    // through to the model's `doStream` call — this is the actual cost-saving
    // wiring the issue is about, not just "the response body ends".
    expect(model.doStreamCalls[0]?.abortSignal?.aborted).toBe(true);
  });

  it("does not persist the exchange when the client aborts mid-stream (#74, F-11)", async () => {
    vi.mocked(getUserId).mockResolvedValue("user-123");
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockModel("Aplica el 13% al servicio prestado.", undefined, 25);

    const controller = new AbortController();
    const response = await POST(
      askRequest({ question: "¿Cuánto es el IVA?" }, controller.signal),
    );

    const events = await readUntilTextDeltaThenAbort(response, controller);

    // A user-initiated stop is not a failure — it must not surface the
    // Spanish "algo salió mal" copy over an answer the user chose to cut off.
    expect(errorMessages(events)).toEqual([]);
    // `streamText`'s own `onFinish` — the only thing that calls
    // `saveQuestion` for the model path — never fires on abort (the SDK
    // routes it through `onAbort` instead), so this is the natural
    // consequence of the abortSignal wiring above, not a separate branch.
    expect(vi.mocked(saveQuestion)).not.toHaveBeenCalled();
  });
});
