/**
 * The per-ask operational event (issue #141, minimum from #121).
 *
 * Three counters already exist — `answer/invariant.ts` (#131),
 * `retrieval-degraded.ts` (#127), `answer/persist-failure.ts` (#139) — and
 * each says the same thing about itself: an in-process tally plus a
 * `console.warn` on a stable prefix, "until #141 owns a metrics pipeline".
 * This is that, and it is deliberately not a pipeline. There is one deployment
 * target (Vercel) whose log drain can already count lines, so what was missing
 * was never transport: it was a *denominator*. A failure counter with no total
 * cannot answer "is 40 citation failures an incident or a Tuesday", which is
 * exactly the question the rollback threshold in `docs/runbook.md` asks.
 *
 * So: one line per ask, whatever the ask did, as JSON on a stable prefix. The
 * three existing `console.warn` prefixes stay untouched and keep their detail
 * (which violation, which embed failure) — this event carries only the flag
 * that one of them fired, so a query can rate-limit-free divide by total asks.
 *
 * ## What may go in it
 *
 * Nothing #136 redacts. No question text, no answer text, no user id, no raw
 * IP, no anonymous subject — a hashed subject is still a per-person key and
 * would turn the log drain into a behavioural record of who asked how often.
 * The shape below is the whole permitted vocabulary: a handful of enums and
 * two booleans, plus `describeError`'s log-safe token, which is the ONLY way
 * an error may appear here (`log-redaction.ts`). A field is either a value
 * from a closed set decided in this file, or it does not go in.
 *
 * ## What it must never do
 *
 * Throw into the ask, or delay it. `emit` swallows everything; the recorder
 * writes at most once, from `onFinish` or from a pre-stream return, both of
 * which are past the last byte the reader is waiting on.
 */

import { describeError } from "./log-redaction";
import type { RateLimitCounter } from "./rate-limit";
import type { RoutedCategory } from "./routing";

/**
 * The stable prefix a log query matches on. Changing it silently breaks the
 * Vercel alert queries the runbook spells out, so it is a constant here and
 * quoted there.
 */
export const TELEMETRY_PREFIX = "tramitico.event";

/**
 * What the ask amounted to, in the vocabulary #141 fixes. Not disjoint by
 * nature — a degraded ask can also decline — so `askOutcome` below picks one
 * by a documented precedence rather than letting call sites decide.
 *
 * - `ok` — an answer was written to the wire.
 * - `declined` — no answer, and nothing broke: the honest decline (weak
 *   retrieval, or #131's fail-closed second violation), a malformed request, a
 *   spent quota, a reader who pressed stop.
 * - `degraded` — an answer was produced with the vector leg dropped (#127).
 * - `refunded_error` — our side broke. Every member either gave the ask back
 *   (`retrieval_failed`, `answer_failed`, per #126) or never charged it
 *   (`rate_limit_unavailable`, denied before any increment landed). This is
 *   the numerator of the error rate the rollback threshold is written against.
 */
export type AskOutcome = "ok" | "declined" | "degraded" | "refunded_error";

/**
 * How long the ask took, coarsely. A bucket rather than a number on purpose:
 * a millisecond count is a weak per-request fingerprint, and nothing we do
 * with this needs better than "did the p-whatever move".
 *
 * Boundaries chosen against the route's own budget (`maxDuration = 60`, a ~5 s
 * embed budget, up to two model attempts): under a second is retrieval-only
 * work, over thirty is one attempt away from being killed by the platform.
 */
export type LatencyBucket =
  "lt_1s" | "1s_3s" | "3s_10s" | "10s_30s" | "gte_30s";

export function latencyBucket(ms: number): LatencyBucket {
  if (!Number.isFinite(ms) || ms < 1_000) return "lt_1s";
  if (ms < 3_000) return "1s_3s";
  if (ms < 10_000) return "3s_10s";
  if (ms < 30_000) return "10s_30s";
  return "gte_30s";
}

/**
 * Why an ask was cut short before its natural end (#205). `client` is the
 * caller's signal firing — Detener and a passive network drop are the same
 * event on the server, deliberately not distinguished. `deadline` is our own
 * internal budget expiring so the refund could run before the platform's
 * `maxDuration` kill. A reason, never a cause: no error text rides here.
 */
export type AskAbort = "client" | "deadline";

export type AskStage =
  "condense" | "retrieve" | "rerank" | "generate" | "validate" | "persist";

/**
 * What the attempt did with the prompt cache (#413): read the cached system
 * prompt, wrote it (the first ask after the entry expired), or neither. A
 * closed set rather than the token counts behind it — the hit rate is a count
 * of `read` lines, and a count of tokens is a number nothing here needs.
 */
export type CacheUse = "read" | "write" | "none";

/** The provider's cache token counts, as the AI SDK reports them. */
export function cacheUse(details: {
  cacheReadTokens: number | undefined;
  cacheWriteTokens: number | undefined;
}): CacheUse {
  if ((details.cacheReadTokens ?? 0) > 0) return "read";
  if ((details.cacheWriteTokens ?? 0) > 0) return "write";
  return "none";
}

export interface GenerationTiming {
  latency: LatencyBucket;
  /** Time to first nonempty text delta; null if none arrived. */
  firstText: LatencyBucket | null;
  /** Prompt-cache use; null when the attempt never reported usage. */
  cache: CacheUse | null;
}

/**
 * The event, in full. Every field is content-free by construction; see the
 * module note. `providerError` is `describeError`'s token — a class name and
 * maybe a status — or `null` when nothing was caught.
 */
export interface AskEvent {
  event: "ask";
  outcome: AskOutcome;
  latency: LatencyBucket;
  stages: Record<AskStage, LatencyBucket | null>;
  generations: GenerationTiming[];
  providerError: string | null;
  citationFailure: boolean;
  quotaHit: boolean;
  /**
   * Which counter denied the ask (#383) — `subject` for the caller's own
   * daily quota (a user, or an anonymous IP + browser family), `ip` for the
   * anonymous per-IP umbrella that every family on one IP shares. Non-null
   * exactly when `quotaHit` is true. A value from `rate-limit.ts`'s closed
   * set; the subject it names never rides here.
   */
  quotaReason: RateLimitCounter | null;
  abort: AskAbort | null;
  /**
   * Which institution the honest decline was routed to (#264) — a value from
   * `routing.ts`'s closed set, or `null` on every ask that was not a
   * weak-retrieval decline. Non-null exactly when retrieval was weak, so a
   * count by category over the non-null lines is the content-free counter of
   * declines by routing category the decision record on #254 asks for. The
   * category is derived from the question by a keyword table; the question
   * itself never rides here.
   */
  routedCategory: RoutedCategory | null;
}

/**
 * Writes one event. Never throws: a serializer that dies, a console that is
 * not there, a runtime mid-teardown — none of them may surface in an ask that
 * has already been answered.
 */
export function emitAskEvent(event: AskEvent): void {
  try {
    console.log(`${TELEMETRY_PREFIX} ${JSON.stringify(event)}`);
  } catch {
    // Telemetry is the least important thing on this request.
  }
}

/**
 * The facts the route accumulates as it goes. Deliberately flags rather than
 * an outcome the call sites assign: the route reaches its terminal points from
 * several directions (a pre-stream return, `execute`'s early returns, the
 * SDK's `onError`), and "which class is this" is one decision, made once,
 * below — not five.
 */
interface AskFacts {
  answered: boolean;
  degraded: boolean;
  failed: boolean;
  citationFailure: boolean;
  quotaHit: boolean;
  quotaReason: RateLimitCounter | null;
  providerError: string | null;
  abort: AskAbort | null;
  routedCategory: RoutedCategory | null;
}

/**
 * The one place the four classes are decided. Precedence, most to least
 * urgent:
 *
 * 1. `failed` — a broken ask is what alerts fire on, and it outranks anything
 *    it may also have been on the way there.
 * 2. `degraded` — the operational fact outranks the product outcome. A
 *    degraded ask that then declined is counted as degraded, because a
 *    lexical-only search is the likeliest reason it had nothing to say; the
 *    decline is the symptom. But not a degraded ask the *client* cut off
 *    (#205): `degraded` means something was produced on a thinner search,
 *    and a refunded non-delivery produced nothing — counting it would
 *    pollute the runbook's degraded-rate query with asks nobody received.
 * 3. `answered` — an answer went out, undegraded.
 * 4. everything else declines. Note what this makes the default: an ask that
 *    reached no terminal point at all — a reader who pressed stop — is
 *    `declined`, not `ok`. Nothing was delivered, so it must not count toward
 *    the success rate.
 */
function askOutcome(facts: AskFacts): AskOutcome {
  if (facts.failed) return "refunded_error";
  if (facts.degraded && facts.abort !== "client") return "degraded";
  if (facts.answered) return "ok";
  return "declined";
}

/**
 * The handle the ask route holds for the length of one request.
 *
 * `emit` is once-only: the route can reach it from `onFinish` and from a
 * pre-stream return, and a double count would quietly halve every rate the
 * runbook queries are written against.
 */
export interface AskTelemetry {
  /** Cumulative elapsed time per stage. Call the once-only stop in finally. */
  startStage: (stage: AskStage) => () => void;
  /** Measures one buffered attempt, including provider errors and cancellation. */
  startGeneration: () => {
    firstText: () => void;
    cache: (use: CacheUse) => void;
    finish: () => void;
  };

  /** An answer was written to the wire. */
  answered: () => void;
  /** The vector leg was dropped for this ask (#127). */
  degraded: () => void;
  /**
   * Our side broke. `error` is optional because one failure door — the
   * limiter reporting itself unavailable — has already logged its own reason
   * and hands us nothing to describe.
   */
  failed: (error?: unknown) => void;
  /** The citation invariant rejected at least one generation (#131). */
  citationFailure: () => void;
  /**
   * The ask was denied because a daily quota was spent (#126): the caller's
   * own, or the anonymous per-IP umbrella (#383).
   */
  quotaHit: (counter: RateLimitCounter) => void;
  /**
   * The ask was cut short (#205). First reason wins: an ask can trip the
   * deadline and then see the client's signal fire as the stream tears down,
   * and the first is the one that says what actually ended it.
   */
  aborted: (reason: AskAbort) => void;
  /** The honest decline on weak retrieval was routed to `category` (#264). */
  routed: (category: RoutedCategory) => void;
  /** Writes the event, once. Further calls are no-ops. */
  emit: () => void;
}

/**
 * Starts the clock. `now` is injectable so a test can pin a latency bucket
 * without waiting out a real ten seconds.
 */
export function createAskTelemetry(
  now: () => number = () => performance.now(),
): AskTelemetry {
  const startedAt = now();
  const facts: AskFacts = {
    answered: false,
    degraded: false,
    failed: false,
    citationFailure: false,
    quotaHit: false,
    quotaReason: null,
    providerError: null,
    abort: null,
    routedCategory: null,
  };
  const durations: Record<AskStage, number | null> = {
    condense: null,
    retrieve: null,
    rerank: null,
    generate: null,
    validate: null,
    persist: null,
  };
  const generations: GenerationTiming[] = [];
  const startStage = (stage: AskStage): (() => void) => {
    const start = now();
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      durations[stage] = (durations[stage] ?? 0) + Math.max(0, now() - start);
    };
  };
  let emitted = false;
  return {
    startStage,
    startGeneration: () => {
      const start = now();
      const stop = startStage("generate");
      let firstText: LatencyBucket | null = null;
      let cache: CacheUse | null = null;
      let finished = false;
      return {
        firstText: () => {
          if (!finished) firstText ??= latencyBucket(now() - start);
        },
        cache: (use: CacheUse) => {
          if (!finished) cache = use;
        },
        finish: () => {
          if (finished) return;
          finished = true;
          stop();
          generations.push({
            latency: latencyBucket(now() - start),
            firstText,
            cache,
          });
        },
      };
    },
    answered: () => {
      facts.answered = true;
    },
    degraded: () => {
      facts.degraded = true;
    },
    failed: (error?: unknown) => {
      facts.failed = true;
      // First error wins. The route can fail twice over one outage — the
      // stream's own error mapper is a second door onto `answer_failed` — and
      // the first one is the one that describes what actually broke.
      if (error !== undefined && facts.providerError === null) {
        facts.providerError = describeError(error);
      }
    },
    citationFailure: () => {
      facts.citationFailure = true;
    },
    quotaHit: (counter: RateLimitCounter) => {
      facts.quotaHit = true;
      facts.quotaReason = counter;
    },
    aborted: (reason: AskAbort) => {
      facts.abort ??= reason;
    },
    routed: (category: RoutedCategory) => {
      facts.routedCategory = category;
    },
    emit: () => {
      if (emitted) return;
      emitted = true;
      emitAskEvent({
        event: "ask",
        outcome: askOutcome(facts),
        latency: latencyBucket(now() - startedAt),
        stages: {
          condense:
            durations.condense === null
              ? null
              : latencyBucket(durations.condense),
          retrieve:
            durations.retrieve === null
              ? null
              : latencyBucket(durations.retrieve),
          rerank:
            durations.rerank === null ? null : latencyBucket(durations.rerank),
          generate:
            durations.generate === null
              ? null
              : latencyBucket(durations.generate),
          validate:
            durations.validate === null
              ? null
              : latencyBucket(durations.validate),
          persist:
            durations.persist === null
              ? null
              : latencyBucket(durations.persist),
        },
        generations,
        providerError: facts.providerError,
        citationFailure: facts.citationFailure,
        quotaHit: facts.quotaHit,
        quotaReason: facts.quotaReason,
        abort: facts.abort,
        routedCategory: facts.routedCategory,
      });
    },
  };
}
