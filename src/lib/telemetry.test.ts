import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cacheUse,
  createAskTelemetry,
  emitAskEvent,
  latencyBucket,
  TELEMETRY_PREFIX,
  type AskEvent,
} from "./telemetry";

/**
 * Captures the telemetry lines a block wrote, parsed back out of the prefix.
 * Reading the wire format rather than a returned object is deliberate: the
 * prefix and the JSON *are* the contract — the runbook's Vercel queries are
 * written against them, not against this module's types.
 */
function captureEvents(): { lines: string[]; events: () => AskEvent[] } {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return {
    lines,
    events: () =>
      lines
        .filter((line) => line.startsWith(`${TELEMETRY_PREFIX} `))
        .map((line) => JSON.parse(line.slice(TELEMETRY_PREFIX.length + 1))),
  };
}

/** A clock the test drives, so a latency bucket costs no real seconds. */
function fakeClock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("latencyBucket", () => {
  it("names each band by its lower edge, inclusive", () => {
    expect(latencyBucket(0)).toBe("lt_1s");
    expect(latencyBucket(999)).toBe("lt_1s");
    expect(latencyBucket(1_000)).toBe("1s_3s");
    expect(latencyBucket(2_999)).toBe("1s_3s");
    expect(latencyBucket(3_000)).toBe("3s_10s");
    expect(latencyBucket(9_999)).toBe("3s_10s");
    expect(latencyBucket(10_000)).toBe("10s_30s");
    expect(latencyBucket(29_999)).toBe("10s_30s");
    expect(latencyBucket(30_000)).toBe("gte_30s");
    expect(latencyBucket(600_000)).toBe("gte_30s");
  });

  it("does not produce a bucket outside the set for a nonsense clock", () => {
    // A monotonic clock that went backwards, or a runtime that handed us a
    // NaN, must not put an unqueryable value in the log line.
    expect(latencyBucket(-1)).toBe("lt_1s");
    expect(latencyBucket(Number.NaN)).toBe("lt_1s");
  });
});

describe("emitAskEvent", () => {
  const event: AskEvent = {
    event: "ask",
    outcome: "ok",
    latency: "1s_3s",
    stages: {
      condense: null,
      retrieve: null,
      rerank: null,
      generate: null,
      validate: null,
      persist: null,
    },
    generations: [],
    providerError: null,
    citationFailure: false,
    quotaHit: false,
    quotaReason: null,
    abort: null,
    routedCategory: null,
  };

  it("writes one line: the stable prefix, a space, then the JSON", () => {
    const capture = captureEvents();
    emitAskEvent(event);
    expect(capture.lines).toEqual([
      `${TELEMETRY_PREFIX} ${JSON.stringify(event)}`,
    ]);
  });

  it("swallows a console that throws — telemetry may not break an answer", () => {
    vi.spyOn(console, "log").mockImplementation(() => {
      throw new Error("stdout is gone");
    });
    expect(() => emitAskEvent(event)).not.toThrow();
  });
});

describe("createAskTelemetry", () => {
  let capture: ReturnType<typeof captureEvents>;

  beforeEach(() => {
    capture = captureEvents();
  });

  it("accumulates repeated stages, leaves skipped stages null, and stops once", () => {
    const clock = fakeClock();
    const telemetry = createAskTelemetry(clock.now);
    const finish = telemetry.startStage("generate");
    clock.advance(2_000);
    finish();
    clock.advance(9_000);
    finish();
    const retry = telemetry.startStage("generate");
    clock.advance(2_000);
    retry();
    telemetry.emit();
    expect(capture.events()[0].stages).toEqual({
      condense: null,
      retrieve: null,
      rerank: null,
      generate: "3s_10s",
      validate: null,
      persist: null,
    });
  });

  it("records first nonempty text separately for each generation, including no-text failure", () => {
    const clock = fakeClock();
    const telemetry = createAskTelemetry(clock.now);
    const first = telemetry.startGeneration();
    clock.advance(2_000);
    first.firstText();
    clock.advance(30_000);
    first.firstText();
    first.finish();
    const retry = telemetry.startGeneration();
    clock.advance(4_000);
    retry.finish();
    telemetry.emit();
    expect(capture.events()[0].generations).toEqual([
      { latency: "gte_30s", firstText: "1s_3s", cache: null },
      { latency: "3s_10s", firstText: null, cache: null },
    ]);
    expect(capture.events()[0].stages.generate).toBe("gte_30s");
  });

  it("records each generation's prompt-cache use when it is reported (#413)", () => {
    const telemetry = createAskTelemetry();
    const first = telemetry.startGeneration();
    first.cache("write");
    first.finish();
    const retry = telemetry.startGeneration();
    retry.cache("read");
    retry.finish();
    const failed = telemetry.startGeneration();
    failed.finish();
    telemetry.emit();
    expect(
      capture.events()[0].generations.map((generation) => generation.cache),
    ).toEqual(["write", "read", null]);
  });

  it("reads cache use from the provider's token counts, not the counts themselves (#413)", () => {
    // A closed enum, per the module note: a token count is a number nobody
    // needs, and the hit rate is a count of «read» lines.
    expect(cacheUse({ cacheReadTokens: 2_800, cacheWriteTokens: 0 })).toBe(
      "read",
    );
    expect(cacheUse({ cacheReadTokens: 0, cacheWriteTokens: 2_800 })).toBe(
      "write",
    );
    expect(cacheUse({ cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe("none");
    expect(
      cacheUse({ cacheReadTokens: undefined, cacheWriteTokens: undefined }),
    ).toBe("none");
  });

  it("emits nothing until asked", () => {
    const telemetry = createAskTelemetry();
    telemetry.answered();
    expect(capture.lines).toEqual([]);
  });

  it("classes a delivered answer as ok", () => {
    const telemetry = createAskTelemetry();
    telemetry.answered();
    telemetry.emit();
    expect(capture.events()[0].outcome).toBe("ok");
  });

  it("classes an ask that delivered nothing as declined, not ok", () => {
    // The default, and the one that matters: an honest decline and a reader
    // who pressed stop both reach `emit` having marked nothing at all.
    const telemetry = createAskTelemetry();
    telemetry.emit();
    expect(capture.events()[0].outcome).toBe("declined");
    expect(capture.events()[0].stages).toEqual({
      condense: null,
      retrieve: null,
      rerank: null,
      generate: null,
      validate: null,
      persist: null,
    });
    expect(capture.events()[0].generations).toEqual([]);
  });

  it("lets a degraded answer outrank ok", () => {
    const telemetry = createAskTelemetry();
    telemetry.degraded();
    telemetry.answered();
    telemetry.emit();
    expect(capture.events()[0].outcome).toBe("degraded");
  });

  it("counts a degraded ask that then declined as degraded", () => {
    const telemetry = createAskTelemetry();
    telemetry.degraded();
    telemetry.emit();
    expect(capture.events()[0].outcome).toBe("degraded");
  });

  it("lets a system failure outrank everything it happened alongside", () => {
    const telemetry = createAskTelemetry();
    telemetry.degraded();
    telemetry.answered();
    telemetry.failed(new Error("provider exploded"));
    telemetry.emit();
    expect(capture.events()[0].outcome).toBe("refunded_error");
  });

  it("names a failure that kept its quota charge charged_error, not refunded_error", () => {
    // The route settles first and says so: a deadline past the first
    // generation, or a search the request's own text broke, keeps the slot
    // (ADR 0013's amendment), and the event must not claim a refund.
    const telemetry = createAskTelemetry();
    telemetry.failed(new Error("ask: internal deadline exceeded"));
    telemetry.aborted("deadline");
    telemetry.chargeKept();
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      outcome: "charged_error",
      abort: "deadline",
    });
  });

  it("reads a kept charge only alongside a failure", () => {
    // Every ask that settles without a refund keeps its charge — a delivered
    // answer most of all — and that alone says nothing about the outcome.
    const answered = createAskTelemetry();
    answered.answered();
    answered.chargeKept();
    answered.emit();
    const stopped = createAskTelemetry();
    stopped.aborted("client");
    stopped.chargeKept();
    stopped.emit();
    expect(capture.events().map((event) => event.outcome)).toEqual([
      "ok",
      "declined",
    ]);
  });

  it("carries the provider error as a describeError token, not a message", () => {
    class APICallError extends Error {
      statusCode = 429;
    }
    const telemetry = createAskTelemetry();
    telemetry.failed(new APICallError("rate limited on prompt: …"));
    telemetry.emit();
    expect(capture.events()[0].providerError).toBe("APICallError#429");
  });

  it("keeps the first error — the second door onto one outage says less", () => {
    const telemetry = createAskTelemetry();
    telemetry.failed(new TypeError("the real cause"));
    telemetry.failed(new Error("the stream noticed too"));
    telemetry.emit();
    expect(capture.events()[0].providerError).toBe("TypeError");
  });

  it("fails without an error at all — the limiter has nothing to describe", () => {
    const telemetry = createAskTelemetry();
    telemetry.failed();
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      outcome: "refunded_error",
      providerError: null,
    });
  });

  it("carries the two flags independently of the outcome", () => {
    const telemetry = createAskTelemetry();
    telemetry.citationFailure();
    telemetry.quotaHit("subject");
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      citationFailure: true,
      quotaHit: true,
      quotaReason: "subject",
    });
  });

  it("names the anonymous per-IP umbrella as its own quota reason (#383)", () => {
    const telemetry = createAskTelemetry();
    telemetry.quotaHit("ip");
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      outcome: "declined",
      quotaHit: true,
      quotaReason: "ip",
    });
  });

  it("leaves the quota reason null on an ask no counter denied", () => {
    const telemetry = createAskTelemetry();
    telemetry.answered();
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      quotaHit: false,
      quotaReason: null,
    });
  });

  it("buckets the elapsed time, not the wall clock", () => {
    const clock = fakeClock();
    const telemetry = createAskTelemetry(clock.now);
    clock.advance(4_200);
    telemetry.answered();
    telemetry.emit();
    expect(capture.events()[0].latency).toBe("3s_10s");
  });

  it("carries the abort reason, and holds outcome to what else was marked (#205)", () => {
    // A client abort delivered nothing and broke nothing: `declined`, with
    // the reason riding beside it rather than becoming a fifth outcome the
    // runbook's queries would miss.
    const telemetry = createAskTelemetry();
    telemetry.aborted("client");
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      outcome: "declined",
      abort: "client",
    });
  });

  it("does not let degraded outrank a client abort — nothing was produced (#205)", () => {
    // The vector leg dropped, then the reader disconnected before anything
    // was delivered. `degraded` means "produced on a thinner search"; a
    // refunded non-delivery produced nothing, so it declines.
    const telemetry = createAskTelemetry();
    telemetry.degraded();
    telemetry.aborted("client");
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      outcome: "declined",
      abort: "client",
    });
  });

  it("keeps the first abort reason — the second signal arrives too late to matter", () => {
    // A deadline expiry can be followed by the client's own signal as the
    // stream tears down; the deadline is what ended the ask.
    const telemetry = createAskTelemetry();
    telemetry.aborted("deadline");
    telemetry.aborted("client");
    telemetry.emit();
    expect(capture.events()[0].abort).toBe("deadline");
  });

  it("carries the routing category of an honest decline (#264)", () => {
    const telemetry = createAskTelemetry();
    telemetry.routed("municipal");
    telemetry.emit();
    expect(capture.events()[0]).toMatchObject({
      outcome: "declined",
      routedCategory: "municipal",
    });
  });

  it("leaves the routing category null on anything that was not a routed decline", () => {
    const telemetry = createAskTelemetry();
    telemetry.answered();
    telemetry.emit();
    expect(capture.events()[0].routedCategory).toBeNull();
  });

  it("writes once — a double count halves every rate queried off it", () => {
    const telemetry = createAskTelemetry();
    telemetry.answered();
    telemetry.emit();
    telemetry.emit();
    expect(capture.events()).toHaveLength(1);
  });
});

/**
 * The acceptance check for #141's privacy requirement, run the way #136's is
 * (`log-redaction.test.ts`): a sentinel question, dependencies that quote it
 * back the way real ones do, and a captured logger that must not have seen it.
 *
 * The stronger half is the last case — the event's key set is asserted
 * exhaustively, so a future field carrying content fails here even if it
 * happens not to contain the sentinel.
 */
describe("no telemetry event can carry content (#141)", () => {
  const SENTINEL = "¿cómo declaro el D-101 si no facturé nada este trimestre?";

  it("does not leak the question through an error that quotes it", () => {
    const capture = captureEvents();
    const telemetry = createAskTelemetry();
    telemetry.failed(
      new Error(`Anthropic rejected the prompt: "${SENTINEL}" (400)`, {
        cause: {
          code: "23514",
          message: `(question)=(${SENTINEL})`,
        },
      }),
    );
    telemetry.citationFailure();
    telemetry.emit();
    expect(capture.lines).toHaveLength(1);
    for (const line of capture.lines) {
      expect(line).not.toContain(SENTINEL);
      expect(line).not.toContain("D-101");
    }
    expect(capture.events()[0].providerError).toBe("Error<Object#23514>");
  });

  it("has no field that could hold content at all", () => {
    const capture = captureEvents();
    const telemetry = createAskTelemetry();
    telemetry.answered();
    telemetry.emit();
    // Exhaustive, not a subset: the event's whole vocabulary is closed enums
    // (the routing category among them, #264), two booleans and one log-safe
    // error token. Nothing here is free text —
    // no question, no answer, no user id, no IP, no subject hash.
    expect(Object.keys(capture.events()[0]).sort()).toEqual([
      "abort",
      "citationFailure",
      "event",
      "generations",
      "latency",
      "outcome",
      "providerError",
      "quotaHit",
      "quotaReason",
      "routedCategory",
      "stages",
    ]);
  });
});
