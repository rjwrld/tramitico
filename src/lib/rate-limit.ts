/**
 * Rate limiting (SPEC §7): fixed-window counter in the `rate_limits` Postgres
 * table. LLM cost is the protected resource, so this fails closed — any DB
 * error denies the request rather than letting it through.
 *
 * The increment itself happens in the `rate_limit_increment` Postgres
 * function (see the matching migration): a single INSERT ... ON CONFLICT
 * statement, so concurrent calls for the same subject can't race, and stale
 * rows past the retention window are swept opportunistically in the same
 * statement.
 *
 * "Daily" means a Costa Rica calendar day (#125): the window opens at 00:00
 * America/Costa_Rica, so a quota resets overnight for the people using this,
 * not at 18:00 local.
 *
 * An anonymous ask is counted twice (#383): once against its subject — IP and
 * coarse browser family — and once against a per-IP umbrella that every
 * family on that IP shares. The family fold exists so a shared CR NAT does
 * not starve its users of each other's quota, but it also hands one IP up to
 * seven independent buckets a day; the umbrella caps what the fold can add
 * without giving the fold up.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import type { Database } from "./database.types";
import { CR_TIME_ZONE, CR_UTC_OFFSET_MS } from "./cr-time";
import { describeError } from "./log-redaction";
import { serviceClient } from "./supabase/service";

export type RateLimitTier = "anon" | "authed";

/**
 * Which counter a denial came from (#383): `subject` is the per-caller row —
 * the user id, or the anonymous IP + family digest — and `ip` is the
 * anonymous per-IP umbrella. Content-free by construction, so it may ride on
 * the telemetry event; the subject itself never does.
 */
export type RateLimitCounter = "subject" | "ip";

export interface RateLimitResult {
  allowed: boolean;
  /** Asks left before the next denial — the tighter of the counters checked. */
  remaining: number;
  resetAt: Date;
  reason: "ok" | "rate_limited" | "unavailable";
  /** The counter that tripped; `null` unless `reason` is `rate_limited`. */
  counter: RateLimitCounter | null;
  /** Ready-to-render ES copy for the 429 body; null when allowed. */
  message: string | null;
  /**
   * Gives this ask back (#126). Bound to the subject and window the check
   * consumed, so the caller never has to carry either — route.ts derives the
   * anonymous subject inside a helper and does not see it otherwise — and a
   * refund can only ever target the row that was incremented.
   *
   * Once-only and never throws: the second call is a no-op, and a failed
   * refund is logged and swallowed. It runs on the failure path of a request
   * that has already gone wrong, and a rejection there would replace the
   * user's error message with a worse one. Losing an ask is the cheaper bug.
   *
   * A no-op when the check did not consume anything (denied or unavailable).
   */
  refund: () => Promise<void>;
}

interface RateLimitRow {
  count: number;
}

type RpcCall =
  | {
      fn: "rate_limit_increment";
      args: { p_subject: string; p_window_start: string; p_cutoff: string };
    }
  | {
      fn: "rate_limit_refund";
      args: { p_subject: string; p_window_start: string };
    };

/** The minimal shape this module needs — easy to fake in tests. */
export interface RpcClient {
  rpc(
    fn: RpcCall["fn"],
    args: RpcCall["args"],
  ): Promise<{
    data: RateLimitRow | null;
    error: { message: string } | null;
  }>;
}

/** Adapts a real Supabase client to the minimal `RpcClient` contract. */
export function supabaseRpcClient(
  supabase: SupabaseClient<Database>,
): RpcClient {
  return {
    rpc: async (fn, args) =>
      fn === "rate_limit_refund"
        ? // A refund whose window has already rolled over matches no row, and
          // that is a legitimate no-op — `.single()` would report it as an
          // error instead. Increment always returns its row.
          supabase
            .rpc(fn, args as { p_subject: string; p_window_start: string })
            .maybeSingle()
        : supabase
            .rpc(
              fn,
              args as {
                p_subject: string;
                p_window_start: string;
                p_cutoff: string;
              },
            )
            .single(),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 2;

const DEFAULT_LIMITS: Record<RateLimitTier, number> = { anon: 10, authed: 50 };

/**
 * The daily quota for a tier: the env override when set, else the SPEC §7
 * default. Exported so `/terminos` states the number that is enforced rather
 * than a copy of it.
 */
export function limitFor(tier: RateLimitTier): number {
  const env = tier === "anon" ? "RATE_LIMIT_ANON" : "RATE_LIMIT_AUTHED";
  const raw = process.env[env];
  if (!raw) return DEFAULT_LIMITS[tier];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMITS[tier];
}

const ANON_IP_MULTIPLIER = 3;

/**
 * The daily ceiling one IP's anonymous asks share across every browser family
 * (#383): `RATE_LIMIT_ANON_IP` when set, else three times the anonymous
 * limit. Derived from `limitFor("anon")` rather than a fixed number so the
 * same-day dial on the per-subject quota moves the umbrella with it.
 */
export function limitForAnonIp(): number {
  const raw = process.env.RATE_LIMIT_ANON_IP;
  const fallback = limitFor("anon") * ANON_IP_MULTIPLIER;
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** The current date in Costa Rica as `YYYY-MM-DD` (#125). */
export function crDate(now = new Date()): string {
  return new Date(now.getTime() - CR_UTC_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * The instant 00:00 Costa Rica began — 06:00 UTC on the same CR date. This is
 * the quota window's start, so "daily" means a CR calendar day for every
 * subject, not just the anonymous ones whose subject already carries the date.
 */
function crDayStart(now = new Date()): Date {
  const shifted = new Date(now.getTime() - CR_UTC_OFFSET_MS);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
    ) + CR_UTC_OFFSET_MS,
  );
}

let cachedClient: RpcClient | null = null;

function defaultClient(): RpcClient {
  if (cachedClient) return cachedClient;
  cachedClient = supabaseRpcClient(serviceClient());
  return cachedClient;
}

/** Coarse browser family only — never the raw User-Agent (SPEC §7 / #24). */
export function coarseUserAgent(userAgent: string): string {
  const ua = userAgent || "";
  if (/Edg\//.test(ua) || /Edge\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua) || /Opera/.test(ua)) return "Opera";
  if (/SamsungBrowser/.test(ua)) return "Samsung Internet";
  if (/Firefox/.test(ua)) return "Firefox";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Safari\//.test(ua)) return "Safari";
  return "Other";
}

export function subjectForUser(uid: string): string {
  return `user:${uid}`;
}

/**
 * Keys the anonymous quota to IP + coarse UA family — the raw IP is never
 * persisted — under a *keyed* digest scoped to the CR date (#125).
 *
 * Both halves matter. The HMAC secret is what makes the subject
 * unreproducible: a plain `sha256(ip|family)` is a value anyone holding an IP
 * and a browser name can recompute and look up, which turns the table into a
 * queryable record of who asked. The date scope caps how long any one subject
 * is linkable to the next — a new CR day is a new key space.
 *
 * Throws when the secret is unset; callers fail closed (see `route.ts`).
 */
export function subjectForAnon(
  ip: string,
  userAgent: string,
  now = new Date(),
): string {
  const family = coarseUserAgent(userAgent);
  return `anon:${anonDigest(`${crDate(now)}|${ip}|${family}`)}`;
}

/**
 * The per-IP umbrella subject (#383): the same keyed, date-scoped digest as
 * `subjectForAnon` over `date|ip` alone, so every browser family on one IP
 * lands on the same row. Its own prefix keeps the two key spaces apart — a
 * subject digest and an umbrella digest can never collide, and a sweep or a
 * test can address either family of rows by prefix.
 *
 * Throws without the secret, exactly as `subjectForAnon` does.
 */
export function subjectForAnonIp(ip: string, now = new Date()): string {
  return `anon-ip:${anonDigest(`${crDate(now)}|${ip}`)}`;
}

function anonDigest(material: string): string {
  const secret = process.env.RATE_LIMIT_SUBJECT_SECRET;
  if (!secret) {
    throw new Error(
      "RATE_LIMIT_SUBJECT_SECRET is required to derive anonymous rate-limit subjects",
    );
  }
  return createHmac("sha256", secret).update(material).digest("hex");
}

export const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "No pudimos verificar su límite de preguntas en este momento. Intente de nuevo en unos minutos.";

/**
 * The reset time as it appears at the end of a sentence, punctuation included:
 * es-CR renders afternoons as "6:00 p. m.", whose own period closes the
 * sentence, so callers must not append a second one.
 */
function resetTimeSentenceEnd(resetAt: Date): string {
  const time = new Intl.DateTimeFormat("es-CR", {
    timeZone: CR_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(resetAt);
  return time.endsWith(".") ? time : `${time}.`;
}

export function rateLimitReachedMessage(
  tier: RateLimitTier,
  resetAt: Date,
): string {
  const time = resetTimeSentenceEnd(resetAt);
  if (tier === "anon") {
    return (
      `Alcanzó el límite de ${limitFor("anon")} preguntas gratis por hoy. ` +
      `Inicie sesión para tener ${limitFor("authed")} preguntas diarias, ` +
      `o vuelva a intentarlo después de las ${time}`
    );
  }
  return (
    `Alcanzó el límite de ${limitFor("authed")} preguntas por hoy. ` +
    `Vuelva a intentarlo después de las ${time}`
  );
}

/** No-op refund for a check that never consumed anything. */
export const NO_REFUND = async (): Promise<void> => {};

/**
 * Builds the once-only refund bound to the row the increment just touched.
 * The guard is per-call, not per-subject: two asks in flight for one subject
 * each own their own refund, and each can give back exactly its own ask.
 */
function refundHandle(
  client: RpcClient,
  subject: string,
  windowStart: Date,
): () => Promise<void> {
  let spent = false;
  return async () => {
    if (spent) return;
    spent = true;
    try {
      const { error } = await client.rpc("rate_limit_refund", {
        p_subject: subject,
        p_window_start: windowStart.toISOString(),
      });
      if (error) throw new Error(error.message);
    } catch (error) {
      // The ask stays consumed. Worth a log — a persistently failing refund
      // is a quota bug — but never worth failing the response over.
      console.error(
        `rate limit: refunding the ask failed: ${describeError(error)}`,
      );
    }
  };
}

/**
 * One `rate_limit_increment` round trip: the subject's count after this ask,
 * or a throw for every way the limiter can fail to answer.
 */
async function increment(
  client: RpcClient,
  subject: string,
  windowStart: Date,
  cutoff: Date,
): Promise<number> {
  const { data, error } = await client.rpc("rate_limit_increment", {
    p_subject: subject,
    p_window_start: windowStart.toISOString(),
    p_cutoff: cutoff.toISOString(),
  });
  if (error || !data)
    throw error ?? new Error("rate_limit_increment: no row returned");
  return data.count;
}

/**
 * Charges `subject` one ask for the CR day containing `now` and, when
 * `umbrella` is given, the anonymous per-IP umbrella too (#383).
 *
 * The umbrella is checked second, and only once the subject allowed: a
 * family that has already spent its own quota does not go on burning the
 * umbrella its NAT neighbours share, which is the whole reason the family
 * fold exists. The cost is one extra RPC on the anonymous asks that get that
 * far, none on the ones the subject counter already turned away.
 *
 * When the umbrella trips, the subject increment that preceded it stays on
 * the row: both counters reset at the same instant, so no ask this subject
 * could make before then would have been allowed anyway — the same
 * "indistinguishable from not counting it" reading as any other denial.
 */
export async function checkRateLimit(
  subject: string,
  tier: RateLimitTier,
  client?: RpcClient,
  now = new Date(),
  umbrella?: string,
): Promise<RateLimitResult> {
  const windowStart = crDayStart(now);
  const resetAt = new Date(windowStart.getTime() + DAY_MS);
  const cutoff = new Date(windowStart.getTime() - RETENTION_DAYS * DAY_MS);
  const limit = limitFor(tier);

  const unavailable = (error: unknown): RateLimitResult => {
    // Fail-closed means every ask 503s until this clears, and the ask event
    // carries no error field of its own for this door (telemetry.ts) — so
    // this line is the only diagnosable signal there is. Its prefix is what
    // the runbook's rate-limit procedure searches for.
    console.error(`rate limit: unavailable — error=${describeError(error)}`);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: "unavailable",
      counter: null,
      message: RATE_LIMIT_UNAVAILABLE_MESSAGE,
      // Nothing was consumed — an increment that never landed has nothing to
      // give back, and refunding here would decrement someone else's ask.
      refund: NO_REFUND,
    };
  };

  // A denial past the limit still incremented the row, by design: the counter
  // is what makes the window fixed. But the caller got no answer out of it,
  // and the count is already past the limit, so refunding it would be
  // indistinguishable from not counting the attempt at all. The 429 reads the
  // same whichever counter tripped (#383): the umbrella is an internal bound,
  // not a second quota the reader is asked to reason about.
  const denied = (counter: RateLimitCounter): RateLimitResult => ({
    allowed: false,
    remaining: 0,
    resetAt,
    reason: "rate_limited",
    counter,
    message: rateLimitReachedMessage(tier, resetAt),
    refund: NO_REFUND,
  });

  // Resolved inside the try: `defaultClient()` throws on missing Supabase
  // credentials, which is one of the fail-closed cases.
  let rpcClient: RpcClient;
  let count: number;
  try {
    rpcClient = client ?? defaultClient();
    count = await increment(rpcClient, subject, windowStart, cutoff);
  } catch (error) {
    return unavailable(error);
  }
  if (count > limit) return denied("subject");

  const refunds = [refundHandle(rpcClient, subject, windowStart)];
  let remaining = limit - count;

  if (umbrella !== undefined) {
    const umbrellaLimit = limitForAnonIp();
    let umbrellaCount: number;
    try {
      umbrellaCount = await increment(rpcClient, umbrella, windowStart, cutoff);
    } catch (error) {
      // The subject increment landed but the ask is now a 503, and
      // `unavailable` promises the caller was never charged (telemetry.ts).
      // Give the subject's ask back before saying so; if that fails too it is
      // logged and the ask is lost, which is the cheaper bug.
      await refunds[0]();
      return unavailable(error);
    }
    if (umbrellaCount > umbrellaLimit) return denied("ip");
    refunds.push(refundHandle(rpcClient, umbrella, windowStart));
    remaining = Math.min(remaining, umbrellaLimit - umbrellaCount);
  }

  return {
    allowed: true,
    remaining,
    resetAt,
    reason: "ok",
    counter: null,
    message: null,
    // Every row this check charged is given back together (#127 semantics):
    // each handle is once-only and swallows its own failure, so a second call
    // is a no-op and one failed refund never blocks the other.
    refund: async () => {
      await Promise.all(refunds.map((refund) => refund()));
    },
  };
}
