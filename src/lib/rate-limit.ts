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
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";
import type { Database } from "./database.types";

export type RateLimitTier = "anon" | "authed";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  reason: "ok" | "rate_limited" | "unavailable";
  /** Ready-to-render ES copy for the 429 body; null when allowed. */
  message: string | null;
}

interface RateLimitRow {
  count: number;
}

/** The minimal shape `checkRateLimit` needs — easy to fake in tests. */
export interface RpcClient {
  rpc(
    fn: "rate_limit_increment",
    args: { p_subject: string; p_window_start: string; p_cutoff: string },
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
    rpc: async (fn, args) => supabase.rpc(fn, args).single(),
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

function utcDayStart(now = new Date()): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

let cachedClient: RpcClient | null = null;

function defaultClient(): RpcClient {
  if (cachedClient) return cachedClient;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for rate limiting",
    );
  }
  const supabase = createClient<Database>(url, key, {
    auth: { persistSession: false },
  });
  cachedClient = supabaseRpcClient(supabase);
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

/** Hashes IP + coarse UA family — the raw IP is never persisted. */
export function subjectForAnon(ip: string, userAgent: string): string {
  const family = coarseUserAgent(userAgent);
  const hash = createHash("sha256").update(`${ip}|${family}`).digest("hex");
  return `anon:${hash}`;
}

export const RATE_LIMIT_UNAVAILABLE_MESSAGE =
  "No pudimos verificar su límite de preguntas en este momento. Intente de nuevo en unos minutos.";

/** Ends with "p. m." in es-CR — that abbreviation's period closes the sentence. */
function formatResetTime(resetAt: Date): string {
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
  const time = formatResetTime(resetAt);
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

export async function checkRateLimit(
  subject: string,
  tier: RateLimitTier,
  client?: RpcClient,
): Promise<RateLimitResult> {
  const windowStart = utcDayStart();
  const resetAt = new Date(windowStart.getTime() + DAY_MS);
  const cutoff = new Date(windowStart.getTime() - RETENTION_DAYS * DAY_MS);
  const limit = limitFor(tier);

  let count: number;
  try {
    const { data, error } = await (client ?? defaultClient()).rpc(
      "rate_limit_increment",
      {
        p_subject: subject,
        p_window_start: windowStart.toISOString(),
        p_cutoff: cutoff.toISOString(),
      },
    );
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
    };
  }

  if (count > limit) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      reason: "rate_limited",
      message: rateLimitReachedMessage(tier, resetAt),
    };
  }

  return {
    allowed: true,
    remaining: limit - count,
    resetAt,
    reason: "ok",
    message: null,
  };
}
