import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { describeError, REDACTED } from "./log-redaction";
import { recordDegradedRetrieval } from "./retrieval-degraded";
import { recordHistorySaveFailure } from "./answer/persist-failure";
import { saveQuestion } from "./answer/persist";
import { retrieve, type RetrievalRpcClient } from "./retrieval";
import type { Embedder } from "./ingestion/embedder";

describe("describeError", () => {
  it("names the class and nothing else for a plain Error", () => {
    expect(describeError(new Error("la pregunta del usuario"))).toBe("Error");
  });

  it("adds `name` only when it says more than the class does", () => {
    const timeout = new Error("aborted");
    timeout.name = "TimeoutError";
    expect(describeError(timeout)).toBe("Error.TimeoutError");
    expect(describeError(new TypeError("nope"))).toBe("TypeError");
  });

  it("keeps the short opaque code — the one thing worth having", () => {
    // The shape PostgREST rejects an insert with: a SQLSTATE plus a message
    // that may quote the row. Only the SQLSTATE survives.
    const pg = { code: "23505", message: "duplicate key … (question)=(…)" };
    expect(describeError(pg)).toBe("Object#23505");
  });

  it("reads an HTTP status off a provider error", () => {
    class APICallError extends Error {
      statusCode = 429;
    }
    expect(describeError(new APICallError("rate limited"))).toBe(
      "APICallError#429",
    );
  });

  it("walks the cause chain, since that is where the context now lives", () => {
    const cause = { code: "42883", message: "function does not exist" };
    class SearchChunksError extends Error {
      constructor() {
        super("search_chunks failed", { cause });
        this.name = "SearchChunksError";
      }
    }
    expect(describeError(new SearchChunksError())).toBe(
      "SearchChunksError<Object#42883>",
    );
  });

  it("stops walking rather than unrolling an unbounded chain", () => {
    const deep = new Error("a", {
      cause: new Error("b", {
        cause: new Error("c", {
          cause: new Error("d", { cause: new Error("e") }),
        }),
      }),
    });
    expect(describeError(deep)).toBe("Error<Error<Error<Error<...>>>>");
  });

  it("survives a cycle", () => {
    const a: { cause?: unknown } = {};
    a.cause = a;
    expect(describeError(a)).toBe("Object<cycle>");
  });

  it("redacts an identifier field that does not look like an identifier", () => {
    // The one hiding place left: a `code` holding prose. Whitespace and
    // non-ASCII are what disqualify it.
    expect(describeError({ code: "¿cuánto es el IVA?" })).toBe(
      `Object#${REDACTED}`,
    );
  });

  it("names the type, never the value, for a non-object throw", () => {
    expect(describeError("¿cuánto es el IVA?")).toBe("string");
    expect(describeError(42)).toBe("number");
    expect(describeError(null)).toBe("null");
    expect(describeError(undefined)).toBe("undefined");
  });

  it("does not throw when the value fights back", () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error("no");
        },
      },
    );
    expect(describeError(hostile)).toBe("unknown");
  });
});

/**
 * The acceptance check for #136 req. 1, run the way the issue asks: a sentinel
 * question, an error that quotes it the way a real dependency would, and a
 * captured logger that must not have seen it.
 *
 * Each case is a real logging path — the counters and `saveQuestion` — not a
 * call to the formatter, because the formatter being correct is only half of
 * it: the other half is that no call site reaches around it.
 */
describe("no log line can carry the question (#136 req. 1)", () => {
  const SENTINEL = "¿cómo declaro el D-101 si no facturé nada este trimestre?";

  let lines: string[];

  beforeEach(() => {
    lines = [];
    const capture = (...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    };
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** How a provider or driver typically quotes the input it choked on. */
  const quoting = (prefix: string) =>
    new Error(`${prefix}: "${SENTINEL}" (400)`);

  const expectClean = () => {
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(SENTINEL);
      expect(line).not.toContain("D-101");
    }
  };

  it("degraded retrieval — the embedding provider echoed the query", () => {
    recordDegradedRetrieval(quoting("Voyage embeddings"));
    expect(lines).toEqual([
      "retrieval: degraded to lexical-only — reason=error error=Error",
    ]);
    expectClean();
  });

  it("history save failure — the insert rejected the row it was given", () => {
    recordHistorySaveFailure({ kind: "answer", error: quoting("insert") });
    expect(lines).toEqual([
      "ask: history save failed — kind=answer error=Error",
    ]);
    expectClean();
  });

  it("saveQuestion — PostgREST quoted the offending row", async () => {
    const client = {
      from: () => ({
        insert: async () => ({
          code: null,
          error: {
            code: "23514",
            message: `new row for relation "questions" violates check … (question)=(${SENTINEL})`,
          },
        }),
      }),
    };
    await expect(
      saveQuestion(
        {
          userId: "user-a",
          question: SENTINEL,
          answer: "",
          citations: [],
        },
        client as unknown as Parameters<typeof saveQuestion>[1],
      ),
    ).resolves.toBe(false);
    expect(lines).toEqual(["saveQuestion: insert failed: Object#23514"]);
    expectClean();
  });

  it("retrieval — the rejection itself is safe to log, message and all", async () => {
    const client: RetrievalRpcClient = {
      rpc: async () => ({
        data: null,
        error: { message: `search on "${SENTINEL}" timed out` },
      }),
    };
    const embedder: Embedder = {
      provider: "fake",
      dimensions: 3,
      embedQuery: async () => [0, 0, 0],
      embed: async () => [],
    };
    const error = await retrieve(SENTINEL, {
      client,
      embedder,
      expander: null,
    }).catch((e: unknown) => e as Error);
    // What the ask route logs for a `retrieval_failed`.
    console.error(`ask: retrieval failed: ${describeError(error)}`);
    expect(lines).toEqual(["ask: retrieval failed: SearchChunksError<Object>"]);
    expectClean();
  });
});
