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
import {
  citationFailures,
  resetCitationFailures,
} from "@/lib/answer/invariant";
import {
  historySaveFailures,
  resetHistorySaveFailures,
} from "@/lib/answer/persist-failure";
import {
  CITATION_RETRY_NOTE,
  WEAK_RETRIEVAL_ANSWER,
} from "@/lib/answer/prompt";
import { saveQuestion } from "@/lib/answer/persist";
import { getAnswerModel } from "@/lib/answer/model";
import { getUserId } from "@/lib/answer/user";
import { checkRateLimit, NO_REFUND } from "@/lib/rate-limit";
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
    fetchedAt: "2026-08-06T15:04:05Z",
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
    isDegraded: false,
    ...overrides,
  };
}

/**
 * Allows the ask and hands back the refund spy bound to it (#126) — the
 * route calls this handle, and only this handle, to give a quota slot back.
 */
function allowRateLimit(): ReturnType<typeof vi.fn> {
  const refund = vi.fn(async () => {});
  vi.mocked(checkRateLimit).mockResolvedValue({
    allowed: true,
    remaining: 9,
    resetAt: new Date(),
    reason: "ok",
    message: null,
    refund,
  });
  return refund;
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
function providerStream(
  deltas: readonly string[],
  chunkDelayInMs = 0,
): ReadableStream<LanguageModelV4StreamPart> {
  return simulateReadableStream<LanguageModelV4StreamPart>({
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
  });
}

function mockModel(
  text: string,
  deltas: readonly string[] = text.split(" ").map((word) => `${word} `),
  chunkDelayInMs = 0,
): MockLanguageModelV4 {
  const model = new MockLanguageModelV4({
    doStream: { stream: providerStream(deltas, chunkDelayInMs) },
  });
  vi.mocked(getAnswerModel).mockReturnValue(model);
  return model;
}

/**
 * A model that answers differently on each call — the shape #131's retry
 * needs. The last text repeats if the route asks more times than there are
 * entries, so "both attempts violate" is `mockModelSequence(bad, bad)` and a
 * third call, were the route ever to make one, would be visible in
 * `doStreamCalls.length` rather than hidden behind an exhausted array.
 */
function mockModelSequence(...texts: readonly string[]): MockLanguageModelV4 {
  let call = 0;
  const model = new MockLanguageModelV4({
    doStream: async () => {
      const text = texts[Math.min(call, texts.length - 1)];
      call += 1;
      return { stream: providerStream(splitWords(text)) };
    },
  });
  vi.mocked(getAnswerModel).mockReturnValue(model);
  return model;
}

/** Word-sized deltas that concatenate back to exactly `text`. */
function splitWords(text: string): string[] {
  return text.split(/(?<= )/);
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
 * Reads the response manually up through the `redactando` status part — the
 * route's own signal that it is about to call the model — then aborts
 * `controller` and drains the rest so `execute` (and its persistence) gets to
 * run to completion. `chunkDelayInMs` on the mocked model (#74) is what makes
 * the abort land mid-generation rather than racing the whole answer through
 * in one microtask.
 *
 * `redactando` rather than the first `text-delta` since #131: the answer is
 * buffered and validated before any of it is written, so no text reaches the
 * wire until generation is already over and there is nothing left to abort.
 */
async function readUntilRedactandoThenAbort(
  response: Response,
  controller: AbortController,
): Promise<SseEvent[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!buffer.includes('"stage":"redactando"')) {
    const { done, value } = await reader.read();
    if (done) throw new Error("stream ended before generation began");
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

/** Payload of each `data-unsaved` part — [] when the row landed (#139). */
function unsavedParts(events: SseEvent[]): unknown[] {
  return events.filter((e) => e.type === "data-unsaved").map((e) => e.data);
}

/** Payload of each `data-degraded` part — [] on an undegraded ask (#127). */
function degradedParts(events: SseEvent[]): unknown[] {
  return events.filter((e) => e.type === "data-degraded").map((e) => e.data);
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
  // The default is a save that lands. `saveQuestion` reports success as a
  // boolean since #139, and a bare `vi.fn()` resolving `undefined` would read
  // as "not saved" — every signed-in case would stream a `data-unsaved` part
  // it never meant to exercise.
  vi.mocked(saveQuestion).mockResolvedValue(true);
  vi.unstubAllEnvs();
  // Reranking defaults on since #25; keep these tests hermetic — a
  // VOYAGE_API_KEY in the developer's shell must not trigger real calls.
  vi.stubEnv("RERANK", "off");
  // Anonymous asks derive their subject with this key (#125); the default
  // caller here is anonymous, so without it every test would fail closed.
  vi.stubEnv("RATE_LIMIT_SUBJECT_SECRET", "test-subject-secret");
  // The #131 tally is module state; a leftover count would make the next
  // case's assertion depend on suite order.
  resetCitationFailures();
  // Same for the #139 tally.
  resetHistorySaveFailures();
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
    // #133: every citations snapshot ships the map the client resolves the
    // inline superscripts with — [2] is the first sello, [1] the second.
    const markerEvents = events.filter((e) => e.type === "data-markers");
    expect(markerEvents).toHaveLength(citationEvents.length);
    expect(markerEvents.at(-1)!.data).toEqual([2, 1]);
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
      refund: NO_REFUND,
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
      refund: NO_REFUND,
    });

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limit_unavailable");
    expect(body.message).toContain("verificar su límite");
    expect(vi.mocked(retrieve)).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when RATE_LIMIT_SUBJECT_SECRET is unset (#125)", async () => {
    vi.stubEnv("RATE_LIMIT_SUBJECT_SECRET", "");
    allowRateLimit();

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(503);
    const body = (await response.json()) as { error: string; message: string };
    expect(body.error).toBe("rate_limit_unavailable");
    // The subject is never derived, so the counter is never touched either.
    expect(vi.mocked(checkRateLimit)).not.toHaveBeenCalled();
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
    // Renumbered to the sello ordering before it is stored, so history can
    // render the same superscripts (#133).
    // (mockModel appends a trailing space to every word.)
    expect(saved.answer).toBe("Aplica el 13%[1]. ");
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
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

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
    // Nothing of the partial answer is kept — the reverse of what #71 did,
    // and the point of #131: an answer cut off by a provider outage is by
    // definition one whose citations were never checked, so it is exactly the
    // text the invariant exists to keep off the wire. The error part is the
    // whole response.
    expect(streamedText(events)).toBe("");
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

    await readUntilRedactandoThenAbort(response, controller);

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

    const events = await readUntilRedactandoThenAbort(response, controller);

    // A user-initiated stop is not a failure — it must not surface the
    // Spanish "algo salió mal" copy over an answer the user chose to cut off.
    expect(errorMessages(events)).toEqual([]);
    // `streamText`'s own `onFinish` — the only thing that calls
    // `saveQuestion` for the model path — never fires on abort (the SDK
    // routes it through `onAbort` instead), so this is the natural
    // consequence of the abortSignal wiring above, not a separate branch.
    expect(vi.mocked(saveQuestion)).not.toHaveBeenCalled();
  });

  /**
   * #126: a system failure gives the ask back, a completed answer keeps it.
   * The boundary is the whole point — if the honest decline were refundable,
   * the cheapest way to ask for free would be to ask something that declines.
   */
  describe("quota (#126)", () => {
    it("refunds the ask when retrieval fails", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockRejectedValue(new Error("pgvector down"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(errorMessages(events)).toHaveLength(1);
      expect(refund).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("refunds the ask when the model dies mid-stream — once, not once per door", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockFailingModel("La tarifa es ");
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      // Both error doors point at the same mapper; the handle's once-only
      // guard is what keeps a single failure from refunding twice.
      expect(refund).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("refunds the ask when execute itself throws", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      vi.mocked(getAnswerModel).mockImplementation(() => {
        throw new Error("ANTHROPIC_API_KEY is not set");
      });
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(refund).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    });

    it("finishes the refund before the response does — not fire-and-forget", async () => {
      // The refund is an RPC. If the route only kicked it off, a serverless
      // function could freeze the moment the body ends and the round trip
      // would never land, silently costing the user the ask this is meant to
      // return. So the response must not complete until the call has settled.
      let settled = false;
      const refund = vi.fn(
        () =>
          new Promise<void>((resolve) =>
            setTimeout(() => {
              settled = true;
              resolve();
            }, 20),
          ),
      );
      vi.mocked(checkRateLimit).mockResolvedValue({
        allowed: true,
        remaining: 9,
        resetAt: new Date(),
        reason: "ok",
        message: null,
        refund,
      });
      vi.mocked(retrieve).mockRejectedValue(new Error("pgvector down"));
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});

      await readEvents(await POST(askRequest({ question: "¿IVA?" })));

      expect(refund).toHaveBeenCalledTimes(1);
      expect(settled).toBe(true);
      spy.mockRestore();
    });

    it("does not refund an honest decline — a delivered answer costs quota", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(
        retrievalResult({ chunks: [], topScore: 0, isWeak: true }),
      );

      const events = await readEvents(
        await POST(askRequest({ question: "asdf qwerty zzz" })),
      );

      expect(streamedText(events)).toContain("No encuentro base oficial");
      expect(refund).not.toHaveBeenCalled();
    });

    it("does not refund a successful answer", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel("La tarifa es 13% [1].");

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(refund).not.toHaveBeenCalled();
    });

    it("does not refund a delivered answer whose history write failed", async () => {
      vi.mocked(getUserId).mockResolvedValue("user-123");
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel("La tarifa es 13% [1].");
      vi.mocked(saveQuestion).mockRejectedValue(new Error("insert failed"));
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      // The user got their answer; persistence is best-effort (persist.ts).
      // It must neither surface an error nor hand the quota slot back.
      expect(streamedText(events)).toContain("La tarifa es 13%");
      expect(errorMessages(events)).toEqual([]);
      expect(refund).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it("does not refund a client-initiated abort", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel("La tarifa es 13% para servicios.", undefined, 25);

      const controller = new AbortController();
      const response = await POST(
        askRequest({ question: "¿Cuánto es el IVA?" }, controller.signal),
      );
      await readUntilRedactandoThenAbort(response, controller);

      // Nothing on our side failed, and a refundable stop would be the same
      // free-ask hole the decline rule closes.
      expect(refund).not.toHaveBeenCalled();
    });
  });

  /**
   * #131: citations stopped being prompt-led. Before any of the answer is
   * written to the wire it must carry at least one marker, and every marker
   * must resolve to a document that was actually retrieved. One retry, then
   * the honest decline — never the uncited text.
   */
  describe("citation invariant (#131)", () => {
    const UNCITED = "La tarifa aplica a todo servicio prestado.";
    const CITED = "La tarifa es 13% [1].";

    it("keeps an uncited answer off the wire and streams the cited retry instead", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      const model = mockModelSequence(UNCITED, CITED);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(streamedText(events)).toBe(CITED);
      expect(streamedText(events)).not.toContain("todo servicio prestado");
      expect(model.doStreamCalls).toHaveLength(2);
      expect(citationFailures()).toEqual({
        no_markers: 1,
        unresolved_markers: 0,
      });
    });

    it("keeps an answer citing a document nobody retrieved off the wire", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      // Two chunks were retrieved, so [9] resolves to nothing. The render path
      // would silently delete that marker and leave the claim bare — which is
      // exactly the failure this invariant exists to catch instead.
      const model = mockModelSequence(
        "Vence el 15 de cada mes [1], salvo excepciones [9].",
        CITED,
      );

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuándo declaro?" })),
      );

      expect(streamedText(events)).toBe(CITED);
      expect(streamedText(events)).not.toContain("15 de cada mes");
      expect(model.doStreamCalls).toHaveLength(2);
      expect(citationFailures()).toEqual({
        no_markers: 0,
        unresolved_markers: 1,
      });
    });

    it("declines honestly when the retry violates too — and stops retrying there", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      const model = mockModelSequence(UNCITED, UNCITED);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(streamedText(events)).toBe(WEAK_RETRIEVAL_ANSWER);
      expect(streamedText(events)).not.toContain("todo servicio prestado");
      // Once, not until it works: the retry budget is one.
      expect(model.doStreamCalls).toHaveLength(2);
      // A decline cites nothing, so no seal may be stamped under it.
      expect(events.filter((e) => e.type === "data-citations")).toHaveLength(0);
      expect(citationFailures()).toEqual({
        no_markers: 2,
        unresolved_markers: 0,
      });
    });

    it("does not surface a failure over the decline — the user gets an answer", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModelSequence(UNCITED, UNCITED);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(errorMessages(events)).toEqual([]);
    });

    it("generates once when the first answer already satisfies the invariant", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      const model = mockModelSequence(CITED);

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(model.doStreamCalls).toHaveLength(1);
      expect(citationFailures()).toEqual({
        no_markers: 0,
        unresolved_markers: 0,
      });
    });

    it("tells the model what it got wrong on the retry", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      const model = mockModelSequence(UNCITED, CITED);

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      // A bare re-roll of the same prompt mostly reproduces the same failure;
      // the retry says what to fix.
      const [first, second] = model.doStreamCalls.map((call) =>
        JSON.stringify(call.prompt),
      );
      expect(first).not.toContain(CITATION_RETRY_NOTE);
      expect(second).toContain(CITATION_RETRY_NOTE);
    });

    it("persists the decline, never the uncited answer, for signed-in users", async () => {
      vi.mocked(getUserId).mockResolvedValue("user-123");
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModelSequence(UNCITED, UNCITED);

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(vi.mocked(saveQuestion)).toHaveBeenCalledWith({
        userId: "user-123",
        question: "¿Cuánto es el IVA?",
        answer: WEAK_RETRIEVAL_ANSWER,
        citations: [],
      });
    });

    it("does not refund a fail-closed decline — it is a delivered answer (#126)", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModelSequence(UNCITED, UNCITED);

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(refund).not.toHaveBeenCalled();
    });
  });

  describe("degraded search (#127)", () => {
    const ANSWER = "La tarifa general es 13% [1].";

    it("labels an answer built on lexical-only retrieval", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(
        retrievalResult({ isDegraded: true }),
      );
      mockModel(ANSWER);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(degradedParts(events)).toEqual([true]);
      // The label qualifies the answer; it does not replace it.
      expect(streamedText(events).trim()).toBe(ANSWER);
      expect(errorMessages(events)).toEqual([]);
    });

    it("lands the label before any of the answer, so nothing is read unlabeled", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(
        retrievalResult({ isDegraded: true }),
      );
      mockModel(ANSWER);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      const types = events.map((e) => e.type);
      expect(types.indexOf("data-degraded")).toBeLessThan(
        types.indexOf("text-delta"),
      );
    });

    it("labels the honest decline too — a thin search is part of why", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(
        retrievalResult({ isDegraded: true, isWeak: true, chunks: [] }),
      );

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(degradedParts(events)).toEqual([true]);
      expect(streamedText(events)).toBe(WEAK_RETRIEVAL_ANSWER);
    });

    it("says nothing at all on a healthy ask", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel(ANSWER);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(degradedParts(events)).toEqual([]);
    });

    it("does not refund a degraded ask — it is a delivered answer (#126)", async () => {
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(
        retrievalResult({ isDegraded: true }),
      );
      mockModel(ANSWER);

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(refund).not.toHaveBeenCalled();
    });
  });
  describe("history-save failures (#139)", () => {
    const ANSWER = "La tarifa general es 13% [1].";

    /** A signed-in ask whose save resolves however `saved` says. */
    async function askSignedIn(
      saved: Promise<boolean> | boolean,
    ): Promise<SseEvent[]> {
      vi.mocked(getUserId).mockResolvedValue("user-123");
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel(ANSWER);
      vi.mocked(saveQuestion).mockImplementation(async () => saved);
      return readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );
    }

    it("marks a delivered answer whose row never landed", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const events = await askSignedIn(false);

      expect(unsavedParts(events)).toEqual([true]);
      // The whole point: the answer is untouched. No error part, no missing
      // text — only the marker that says it is not in the history.
      expect(streamedText(events).trim()).toBe(ANSWER);
      expect(errorMessages(events)).toEqual([]);
      warn.mockRestore();
    });

    it("marks it when the save rejects outright, not just when it reports", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      vi.mocked(getUserId).mockResolvedValue("user-123");
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel(ANSWER);
      vi.mocked(saveQuestion).mockRejectedValue(new Error("socket closed"));

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(unsavedParts(events)).toEqual([true]);
      expect(streamedText(events).trim()).toBe(ANSWER);
      warn.mockRestore();
    });

    it("lands the marker before finish, so it reaches the message", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      const events = await askSignedIn(false);

      const types = events.map((e) => e.type);
      // A part written past `finish` belongs to no message the client is
      // still assembling — which is why persistence now precedes it.
      expect(types.indexOf("data-unsaved")).toBeGreaterThan(
        types.lastIndexOf("text-delta"),
      );
      expect(types.indexOf("data-unsaved")).toBeLessThan(
        types.lastIndexOf("finish"),
      );
      warn.mockRestore();
    });

    it("says nothing when the row landed", async () => {
      const events = await askSignedIn(true);

      expect(unsavedParts(events)).toEqual([]);
    });

    it("says nothing for an anonymous ask — there is no history to lose", async () => {
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel(ANSWER);

      const events = await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(vi.mocked(saveQuestion)).not.toHaveBeenCalled();
      expect(unsavedParts(events)).toEqual([]);
    });

    it("marks a lost honest decline too — the reader was still given an answer", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(getUserId).mockResolvedValue("user-123");
      allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(
        retrievalResult({ chunks: [], topScore: 0, isWeak: true }),
      );
      vi.mocked(saveQuestion).mockResolvedValue(false);

      const events = await readEvents(
        await POST(askRequest({ question: "asdf qwerty zzz" })),
      );

      expect(unsavedParts(events)).toEqual([true]);
      expect(streamedText(events)).toBe(WEAK_RETRIEVAL_ANSWER);
      expect(errorMessages(events)).toEqual([]);
      warn.mockRestore();
    });

    it("counts the failure under the kind of answer it lost (req. 2)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

      await askSignedIn(false);

      expect(historySaveFailures()).toEqual({ answer: 1, decline: 0 });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("ask: history save failed — kind=answer"),
      );
      warn.mockRestore();
    });

    it("does not refund a lost row — the answer was delivered (#126)", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      vi.mocked(getUserId).mockResolvedValue("user-123");
      const refund = allowRateLimit();
      vi.mocked(retrieve).mockResolvedValue(retrievalResult());
      mockModel(ANSWER);
      vi.mocked(saveQuestion).mockResolvedValue(false);

      await readEvents(
        await POST(askRequest({ question: "¿Cuánto es el IVA?" })),
      );

      expect(refund).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });
});
