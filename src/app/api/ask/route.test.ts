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

function mockModel(text: string): void {
  vi.mocked(getAnswerModel).mockReturnValue(
    new MockLanguageModelV4({
      doStream: {
        stream: simulateReadableStream<LanguageModelV4StreamPart>({
          chunks: [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "t1" },
            ...text.split(" ").map((word): LanguageModelV4StreamPart => ({
              type: "text-delta",
              id: "t1",
              delta: `${word} `,
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
    }),
  );
}

function askRequest(body: unknown): Request {
  return new Request("http://localhost/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface SseEvent {
  type: string;
  delta?: string;
  data?: unknown;
}

async function readEvents(response: Response): Promise<SseEvent[]> {
  const text = await new Response(response.body).text();
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice("data: ".length)) as SseEvent);
}

function streamedText(events: SseEvent[]): string {
  return events
    .filter((e) => e.type === "text-delta")
    .map((e) => e.delta)
    .join("");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserId).mockResolvedValue(null);
  vi.unstubAllEnvs();
});

describe("POST /api/ask", () => {
  it("streams the answer with citations delivered as data parts in order of use", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockModel("La tarifa es 13% [2]. Aplica a servicios [1] y también [2].");

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(200);
    const events = await readEvents(response);

    expect(streamedText(events)).toContain("La tarifa es 13%");
    const citationEvents = events.filter((e) => e.type === "data-citations");
    expect(citationEvents.length).toBeGreaterThan(0);
    const final = citationEvents.at(-1)!.data as { docKey: string }[];
    expect(final.map((c) => c.docKey)).toEqual(["doc-2", "doc-1"]);
    // Retrieval fetched the rerank pool, not just top-8.
    expect(vi.mocked(retrieve)).toHaveBeenCalledWith("¿Cuánto es el IVA?", {
      matchCount: 30,
    });
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
  });

  it("returns 429 with the friendly ES limit message when rate limited", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      reason: "rate_limited",
      message: "Alcanzaste el límite de 10 preguntas gratis por hoy.",
    });

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("límite de 10 preguntas");
    expect(vi.mocked(retrieve)).not.toHaveBeenCalled();
  });

  it("fails closed with 503 when the rate limiter is unavailable", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({
      allowed: false,
      remaining: 0,
      resetAt: new Date(),
      reason: "unavailable",
      message: "No pudimos verificar tu límite de preguntas en este momento.",
    });

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(503);
    expect(vi.mocked(retrieve)).not.toHaveBeenCalled();
  });

  it("rejects a missing or empty question with a 400 and an ES message", async () => {
    for (const body of [{}, { question: "  " }, { question: 42 }]) {
      const response = await POST(askRequest(body));
      expect(response.status).toBe(400);
      const parsed = (await response.json()) as { error: string };
      expect(parsed.error).toMatch(/pregunta/i);
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

  it("does not persist anything for anonymous users", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockResolvedValue(retrievalResult());
    mockModel("Aplica el 13% [1].");

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    await readEvents(response);
    expect(vi.mocked(saveQuestion)).not.toHaveBeenCalled();
  });

  it("returns 502 with an ES message when retrieval throws", async () => {
    allowRateLimit();
    vi.mocked(retrieve).mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await POST(askRequest({ question: "¿Cuánto es el IVA?" }));
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/documentos oficiales/);
    spy.mockRestore();
  });
});
