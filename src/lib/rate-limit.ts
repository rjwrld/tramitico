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
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";
import type { Database } from "./database.types";
import { serviceClient } from "./supabase/service";

export type RateLimitTier = "anon" | "authed";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason: "ok" | "rate_limited" | "unavailable";
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
const CR_TIME_ZONE = "America/Costa_Rica";

const DEFAULT_LIMITS: Record<RateLimitTier, number> = { anon: 10, authed: 50 };

function limitFor(tier: RateLimitTier): number {
  const env = tier === "anon" ? "RATE_LIMIT_ANON" : "RATE_LIMIT_AUTHED";
  const raw = process.env[env];
  if (!raw) return DEFAULT_LIMITS[tier];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_LIMITS[tier];
}

/**
 * Costa Rica is UTC-6 year-round — no DST since 1992 — so the whole CR
 * calendar is a fixed shift, and neither of the two functions below needs a
 * timezone database. That decision is #121's; `CR_TIME_ZONE` above stays for
 * `Intl` formatting, which does want the real zone name.
 */
const CR_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;

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
  const secret = process.env.RATE_LIMIT_SUBJECT_SECRET;
  if (!secret) {
    throw new Error(
      "RATE_LIMIT_SUBJECT_SECRET is required to derive anonymous rate-limit subjects",
    );
  }
  const family = coarseUserAgent(userAgent);
  const mac = createHmac("sha256", secret)
    .update(`${crDate(now)}|${ip}|${family}`)
    .digest("hex");
  return `anon:${mac}`;
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
      console.error(`rate limit: refunding the ask failed: ${String(error)}`);
    }
  };
}

export async function checkRateLimit(
  subject: string,
  tier: RateLimitTier,
  client?: RpcClient,
  now = new Date(),
): Promise<RateLimitResult> {
  const windowStart = crDayStart(now);
  const resetAt = new Date(windowStart.getTime() + DAY_MS);
  const cutoff = new Date(windowStart.getTime() - RETENTION_DAYS * DAY_MS);
  const limit = limitFor(tier);

  let count: number;
  // Resolved inside the try: `defaultClient()` throws on missing Supabase
  // credentials, which is one of the fail-closed cases below.
  let rpcClient: RpcClient;
  try {
    rpcClient = client ?? defaultClient();
    const { data, error } = await rpcClient.rpc("rate_limit_increment", {
      p_subject: subject,
      p_window_start: windowStart.toISOString(),
      p_cutoff: cutoff.toISOString(),
    });
    if (error || !data)
      throw error ?? new Error("rate_limit_increment: no row returned");
    count = data.count;
  } catch {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: "unavailable",
      message: RATE_LIMIT_UNAVAILABLE_MESSAGE,
      // Nothing was consumed — an increment that never landed has nothing to
      // give back, and refunding here would decrement someone else's ask.
      refund: NO_REFUND,
    };
  }

  // A denial past the limit still incremented the row, by design: the counter
  // is what makes the window fixed. But the caller got no answer out of it,
  // and the count is already past the limit, so refunding it would be
  // indistinguishable from not counting the attempt at all.
  if (count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: "rate_limited",
      message: rateLimitReachedMessage(tier, resetAt),
      refund: NO_REFUND,
    };
  }

  return {
    allowed: true,
    remaining: limit - count,
    resetAt,
    reason: "ok",
    message: null,
    refund: refundHandle(rpcClient, subject, windowStart),
  };
}
