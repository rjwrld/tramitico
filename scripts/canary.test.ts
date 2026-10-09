import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { describe, expect, it } from "vitest";
import {
  askStreamErrorText,
  CITATIONS_PART_ID,
  DEGRADED_PART_ID,
  MARKERS_PART_ID,
  RERANKED_PART_ID,
  ROUTED_PART_ID,
  type AskDataParts,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { citationMarkers, unclosedMarkers } from "@/lib/answer/citations";
import { isCitation, type Citation } from "@/lib/citations";
import {
  askOnce,
  assessStream,
  CANARY_QUESTIONS,
  canaryHost,
  DEFAULT_HOST,
  formatVerdict,
  markersIn,
  PART,
  parseStream,
  unclosedIn,
  type CanaryQuestion,
  type StreamPart,
} from "./canary";

/*
 * The canary carries its own copy of the wire's names and the marker syntax
 * so the workflow can run it without an install (canary.ts). These pin the
 * copies to the modules that own them.
 */
describe("the canary's copy of the wire", () => {
  it("names only data parts the contract declares", () => {
    const declared: Record<keyof AskDataParts, true> = {
      citations: true,
      markers: true,
      status: true,
      degraded: true,
      unsaved: true,
      routed: true,
      reranked: true,
    };
    for (const type of Object.values(PART)) {
      expect(Object.keys(declared)).toContain(type.slice("data-".length));
    }
    expect([
      CITATIONS_PART_ID,
      MARKERS_PART_ID,
      DEGRADED_PART_ID,
      RERANKED_PART_ID,
    ]).toEqual(["citations", "markers", "degraded", "reranked"]);
  });

  const samples = [
    "La tarifa es 13 % [1][3], según el reglamento [12].",
    "Sin marcadores.",
    "Un corchete abierto [49 tomando base y otro [10: cita 7]",
    "Cifras entre corchetes [1.500] y [13,5] no son marcadores [2].",
    "Al final [7",
    "Texto legal [nota] y [12x] se queda [4]—y sigue [5].",
  ];

  it.each(samples)("reads markers as citationMarkers does: %s", (text) => {
    expect(markersIn(text)).toEqual(citationMarkers(text));
  });

  it.each(samples)(
    "reads unclosed markers as unclosedMarkers does: %s",
    (text) => {
      expect(unclosedIn(text)).toEqual(unclosedMarkers(text));
    },
  );

  it("accepts as a seal everything isCitation accepts", () => {
    const seal: Citation = {
      docKey: "ley-iva",
      docTitle: "Ley del Impuesto sobre el Valor Agregado",
      norma: "Ley 6826",
      articulo: "Artículo 10",
      url: null,
    };
    expect(isCitation(seal)).toBe(true);
    const verdict = assessStream(
      IVA,
      answerParts({ citations: [seal], markers: [1, 1, 1] }),
    );
    expect(verdict.failures).toEqual([]);
  });
});

const IVA = CANARY_QUESTIONS[0];
const CCSS: CanaryQuestion = CANARY_QUESTIONS[1];

const SEALS: Citation[] = [
  {
    docKey: "ley-iva",
    docTitle: "Ley del Impuesto sobre el Valor Agregado",
    norma: "Ley 6826",
    articulo: "Artículo 10",
    url: "https://pgrweb.go.cr/scij/",
    fetchedAt: "2026-10-01T12:00:00Z",
  },
  {
    docKey: "reglamento-iva",
    docTitle: "Reglamento de la Ley del Impuesto sobre el Valor Agregado",
    norma: "Decreto Ejecutivo 41779",
    articulo: "Artículo 11",
    url: "https://pgrweb.go.cr/scij/",
  },
];

/**
 * An answer the way `route.ts` writes one: start, status stages, the text a
 * word per delta, then the citations snapshot and the marker map.
 */
function answerParts({
  text = "La tarifa general es del 13 % [1], y se cobra al prestar el servicio [3].",
  citations = SEALS,
  // Chunk index → seal ordinal: chunks 1 and 2 share seal 1, chunk 3 is seal 2.
  markers = [1, 1, 2, 0, 0, 0, 0, 0],
  extra = [],
  reranked = true,
  finish = true,
}: {
  text?: string;
  citations?: Citation[];
  markers?: number[];
  extra?: StreamPart[];
  reranked?: boolean | null;
  finish?: boolean;
} = {}): StreamPart[] {
  return [
    { type: "start" },
    { type: "data-status", id: "status", data: { stage: "buscando" } },
    ...extra,
    ...(reranked === null
      ? []
      : [{ type: PART.reranked, id: RERANKED_PART_ID, data: reranked }]),
    { type: "data-status", id: "status", data: { stage: "redactando" } },
    { type: "data-status", id: "status", data: { stage: "verificando" } },
    { type: "text-start", id: "answer" },
    ...text
      .split(/(?<= )/)
      .map((delta) => ({ type: "text-delta", id: "answer", delta })),
    { type: "text-end", id: "answer" },
    { type: "data-citations", id: CITATIONS_PART_ID, data: citations },
    { type: "data-markers", id: MARKERS_PART_ID, data: markers },
    ...(finish ? [{ type: "finish" }] : []),
  ];
}

/**
 * The honest decline (`streamHonestDecline`): no citations, ever. Routed on
 * weak retrieval, before the rerank; unrouted when it fails closed (#131),
 * after the rerank has written its part.
 */
function declineParts(routed: string | null): StreamPart[] {
  return [
    { type: "start" },
    { type: "data-status", id: "status", data: { stage: "buscando" } },
    ...(routed === null
      ? [{ type: PART.reranked, id: RERANKED_PART_ID, data: true }]
      : [
          {
            type: "data-routed",
            id: ROUTED_PART_ID,
            data: { category: routed },
          },
        ]),
    { type: "text-start", id: "fallback" },
    {
      type: "text-delta",
      id: "fallback",
      delta: "No encontré base en los documentos oficiales.",
    },
    { type: "text-end", id: "fallback" },
    { type: "finish" },
  ];
}

/** Encodes parts the way the route's response does — through the AI SDK. */
function sdkResponse(parts: readonly StreamPart[]): Response {
  const stream = createUIMessageStream<AskUIMessage>({
    execute: ({ writer }) => {
      for (const part of parts) {
        writer.write(part as Parameters<typeof writer.write>[0]);
      }
    },
  });
  return createUIMessageStreamResponse({ stream });
}

function fetchReturning(response: Response): typeof fetch {
  return (async () => response) as typeof fetch;
}

describe("assessStream", () => {
  it("passes a cited answer whose every marker resolves", () => {
    const verdict = assessStream(IVA, answerParts());
    expect(verdict.failures).toEqual([]);
    expect(verdict).toMatchObject({ citations: 2, markers: 8, reranked: true });
  });

  it("fails an error part by its code — the refunded_error on the wire", () => {
    const parts: StreamPart[] = [
      { type: "start" },
      {
        type: "error",
        errorText: askStreamErrorText("answer_failed", "No se pudo."),
      },
    ];
    expect(assessStream(IVA, parts).failures).toEqual([
      "error part: answer_failed",
      "no finish part: the stream was cut short",
      "no answer text",
    ]);
  });

  it("fails a degraded answer", () => {
    const parts = answerParts({
      extra: [{ type: "data-degraded", id: DEGRADED_PART_ID, data: true }],
    });
    expect(assessStream(IVA, parts).failures).toEqual([
      "degraded: retrieval ran without its vector leg (#127)",
    ]);
  });

  it("fails a routed decline", () => {
    expect(assessStream(CCSS, declineParts("ccss")).failures).toEqual([
      "declined: routed to ccss",
    ]);
  });

  it("fails the fail-closed decline, which carries no routed part", () => {
    expect(assessStream(CCSS, declineParts(null)).failures).toEqual([
      "no citations: an uncited answer or the fail-closed decline",
    ]);
  });

  it("fails a marker the marker map sends to no seal", () => {
    const parts = answerParts({ text: "El 13 % [1] aplica [4] y [9]." });
    expect(assessStream(IVA, parts).failures).toEqual([
      "marker [4] resolves to no seal",
      "marker [9] resolves to no seal",
    ]);
  });

  it("fails an ordinal past the seals the snapshot holds", () => {
    const parts = answerParts({ markers: [1, 1, 3, 0, 0, 0, 0, 0] });
    expect(assessStream(IVA, parts).failures).toEqual([
      "marker [3] resolves to no seal",
    ]);
  });

  it("fails an answer with seals but no marker in its text", () => {
    const parts = answerParts({ text: "La tarifa general es del 13 %." });
    expect(assessStream(IVA, parts).failures).toEqual([
      "no citation markers in the answer",
    ]);
  });

  it("fails an unclosed marker that reaches the reader", () => {
    const parts = answerParts({ text: "El 13 % [1] y el resto [3 según." });
    expect(assessStream(IVA, parts).failures).toEqual(["unclosed marker [3"]);
  });

  it("fails a citation that is not a seal", () => {
    const parts = answerParts({
      citations: [SEALS[0], { docKey: 7 } as unknown as Citation],
    });
    expect(assessStream(IVA, parts).failures).toEqual([
      "citation 2 is not a seal",
    ]);
  });

  it("fails a stream cut short of its finish part", () => {
    expect(assessStream(IVA, answerParts({ finish: false })).failures).toEqual([
      "no finish part: the stream was cut short",
    ]);
  });

  it("fails an answer whose rerank did not run (#498)", () => {
    expect(
      assessStream(IVA, answerParts({ reranked: false })).failures,
    ).toEqual(["the rerank did not run (#498)"]);
  });

  it("fails an answer that never says whether the rerank ran", () => {
    expect(assessStream(IVA, answerParts({ reranked: null })).failures).toEqual(
      ["no data-reranked part: the rerank never reported"],
    );
  });

  it("does not ask the part of a routed decline, which never reaches the rerank", () => {
    expect(assessStream(CCSS, declineParts("ccss")).failures).not.toContain(
      "no data-reranked part: the rerank never reported",
    );
  });

  it("asks a percentage of the rate question only", () => {
    const text = "Se cobra la tarifa general [1].";
    expect(assessStream(IVA, answerParts({ text })).failures).toEqual([
      "no percentage in an answer that asks for a rate",
    ]);
    expect(assessStream(CCSS, answerParts({ text })).failures).toEqual([]);
  });

  it("fails a line that is not JSON", () => {
    const parts = parseStream("data: {not json\n\n");
    expect(assessStream(IVA, parts).failures).toContain(
      "unparseable stream line",
    );
  });
});

describe("askOnce", () => {
  it("passes an answer encoded by the AI SDK, as production sends it", async () => {
    const response = sdkResponse(answerParts());
    expect(response.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const verdict = await askOnce(DEFAULT_HOST, IVA, fetchReturning(response));
    expect(verdict.failures).toEqual([]);
    expect(verdict.excerpt).toMatch(/^La tarifa general es del 13 %/);
  });

  it("fails a degraded answer encoded by the AI SDK", async () => {
    const response = sdkResponse(
      answerParts({
        extra: [{ type: "data-degraded", id: DEGRADED_PART_ID, data: true }],
      }),
    );
    const verdict = await askOnce(DEFAULT_HOST, IVA, fetchReturning(response));
    expect(verdict.failures).toEqual([
      "degraded: retrieval ran without its vector leg (#127)",
    ]);
  });

  it("sends a JSON ask with no Origin to /api/ask on the host", async () => {
    let seen: Request | null = null;
    const fetchImpl = (async (input: URL, init: RequestInit) => {
      seen = new Request(input, init);
      return sdkResponse(answerParts());
    }) as unknown as typeof fetch;
    await askOnce("https://example.test", IVA, fetchImpl);
    const request = seen as unknown as Request;
    expect(request.url).toBe("https://example.test/api/ask");
    expect(request.method).toBe("POST");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(request.headers.get("origin")).toBeNull();
    expect(await request.json()).toEqual({ question: IVA.question });
  });

  it("fails a non-200 by its envelope's code", async () => {
    const response = Response.json(
      { error: "rate_limit_unavailable", message: "…" },
      { status: 503 },
    );
    const verdict = await askOnce(DEFAULT_HOST, IVA, fetchReturning(response));
    expect(verdict.failures).toEqual(["HTTP 503: rate_limit_unavailable"]);
  });

  it("fails a 200 that is not a stream", async () => {
    const response = new Response("<html></html>", {
      headers: { "content-type": "text/html" },
    });
    const verdict = await askOnce(DEFAULT_HOST, IVA, fetchReturning(response));
    expect(verdict.failures).toEqual(["not a stream: content-type text/html"]);
  });

  it("fails an unreachable host without throwing", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed", {
        cause: Object.assign(new Error("getaddrinfo"), { code: "ENOTFOUND" }),
      });
    }) as unknown as typeof fetch;
    const verdict = await askOnce("https://nope.invalid", IVA, fetchImpl);
    expect(verdict.failures).toEqual(["request failed: TypeError ENOTFOUND"]);
  });
});

describe("formatVerdict", () => {
  it("prints counts, failures and the answer's opening", () => {
    const verdict = assessStream(CCSS, declineParts("ccss"));
    expect(formatVerdict(verdict)).toBe(
      [
        "FAIL  ccss-cuota-independiente — citations=- markers=- reranked=-",
        "      - declined: routed to ccss",
        "      answer: «No encontré base en los documentos oficiales.»",
      ].join("\n"),
    );
  });
});

describe("canaryHost", () => {
  it("defaults to production and keeps only the origin", () => {
    expect(canaryHost(undefined)).toBe("https://tramitico.com");
    expect(canaryHost("  ")).toBe("https://tramitico.com");
    expect(canaryHost("https://nope.invalid/api/ask")).toBe(
      "https://nope.invalid",
    );
  });

  it("refuses a scheme that is not http(s), and a non-URL", () => {
    expect(() => canaryHost("file:///etc/passwd")).toThrow(/http\(s\)/);
    expect(() => canaryHost("tramitico")).toThrow();
  });
});

describe("the fixed questions", () => {
  it("are three, with distinct ids, one of them asking a rate", () => {
    expect(new Set(CANARY_QUESTIONS.map((q) => q.id)).size).toBe(3);
    expect(CANARY_QUESTIONS.filter((q) => q.percentage)).toHaveLength(1);
  });
});
