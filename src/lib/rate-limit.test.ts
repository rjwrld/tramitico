import { existsSync, readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  coarseUserAgent,
  crDate,
  rateLimitReachedMessage,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  subjectForAnon,
  subjectForUser,
  supabaseRpcClient,
  type RateLimitResult,
  type RpcClient,
} from "./rate-limit";
import type { Database } from "./database.types";
import { serviceClient } from "./supabase/service";

function loadDotEnvLocal() {
  const file = path.resolve(__dirname, "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDotEnvLocal();

// Required in production (#125); the value is irrelevant to every assertion
// here except the ones that vary it on purpose.
process.env.RATE_LIMIT_SUBJECT_SECRET ??= "test-subject-secret";

function fakeClient(
  data: { count: number } | null,
  error: { message: string } | null = null,
): RpcClient {
  return { rpc: async () => ({ data, error }) };
}

describe("coarseUserAgent", () => {
  it("prefers Edge over the Chrome/Safari tokens it also carries", () => {
    expect(
      coarseUserAgent(
        "Mozilla/5.0 Windows NT 10.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36 Edg/120.0",
      ),
    ).toBe("Edge");
  });

  it("prefers Opera over the Chrome/Safari tokens it also carries", () => {
    expect(
      coarseUserAgent(
        "Mozilla/5.0 Windows NT 10.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36 OPR/100.0",
      ),
    ).toBe("Opera");
  });

  it("falls back to Chrome when only Chrome/Safari tokens are present", () => {
    expect(
      coarseUserAgent(
        "Mozilla/5.0 Windows NT 10.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
      ),
    ).toBe("Chrome");
  });

  it("identifies plain Safari", () => {
    expect(
      coarseUserAgent(
        "Mozilla/5.0 Macintosh AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15",
      ),
    ).toBe("Safari");
  });

  it("identifies Firefox", () => {
    expect(
      coarseUserAgent(
        "Mozilla/5.0 Windows NT 10.0 Gecko/20100101 Firefox/121.0",
      ),
    ).toBe("Firefox");
  });

  it("falls back to Other for unrecognized strings", () => {
    expect(coarseUserAgent("SomeCrawler/1.0")).toBe("Other");
    expect(coarseUserAgent("")).toBe("Other");
  });
});

describe("subjectForUser", () => {
  it("prefixes the uid", () => {
    expect(subjectForUser("abc-123")).toBe("user:abc-123");
  });
});

describe("crDate", () => {
  it("rolls to the next date at 06:00 UTC, not at 00:00 UTC", () => {
    expect(crDate(new Date("2026-08-12T05:59:59Z"))).toBe("2026-08-11");
    expect(crDate(new Date("2026-08-12T06:00:00Z"))).toBe("2026-08-12");
  });

  it("keeps a UTC-midnight crossing inside the same CR day", () => {
    expect(crDate(new Date("2026-08-11T23:59:59Z"))).toBe("2026-08-11");
    expect(crDate(new Date("2026-08-12T00:00:01Z"))).toBe("2026-08-11");
  });
});

describe("subjectForAnon", () => {
  const ua = "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
  const noon = new Date("2026-08-12T18:00:00Z"); // noon in Costa Rica

  it("is stable for the same ip + UA family within a CR day", () => {
    expect(subjectForAnon("203.0.113.5", ua, noon)).toBe(
      subjectForAnon("203.0.113.5", ua, noon),
    );
  });

  it("differs across IPs", () => {
    expect(subjectForAnon("203.0.113.5", ua, noon)).not.toBe(
      subjectForAnon("203.0.113.6", ua, noon),
    );
  });

  it("differs across CR dates for the same ip + UA", () => {
    expect(subjectForAnon("203.0.113.5", ua, noon)).not.toBe(
      subjectForAnon("203.0.113.5", ua, new Date("2026-08-13T18:00:00Z")),
    );
  });

  it("holds across UTC midnight — the same CR day is the same subject", () => {
    expect(
      subjectForAnon("203.0.113.5", ua, new Date("2026-08-11T23:59:00Z")),
    ).toBe(subjectForAnon("203.0.113.5", ua, new Date("2026-08-12T00:01:00Z")));
  });

  it("is not reproducible without the secret — a different secret, a different subject", () => {
    const saved = process.env.RATE_LIMIT_SUBJECT_SECRET;
    try {
      process.env.RATE_LIMIT_SUBJECT_SECRET = "secret-a";
      const a = subjectForAnon("203.0.113.5", ua, noon);
      process.env.RATE_LIMIT_SUBJECT_SECRET = "secret-b";
      const b = subjectForAnon("203.0.113.5", ua, noon);
      expect(a).not.toBe(b);
      // Nor is it the unsalted digest anyone could recompute from ip + family.
      const unsalted = createHash("sha256")
        .update("203.0.113.5|Chrome")
        .digest("hex");
      expect(a).not.toContain(unsalted);
    } finally {
      process.env.RATE_LIMIT_SUBJECT_SECRET = saved;
    }
  });

  it("throws when the secret is unset — the caller must fail closed", () => {
    const saved = process.env.RATE_LIMIT_SUBJECT_SECRET;
    delete process.env.RATE_LIMIT_SUBJECT_SECRET;
    try {
      expect(() => subjectForAnon("203.0.113.5", ua, noon)).toThrow(
        /RATE_LIMIT_SUBJECT_SECRET/,
      );
    } finally {
      process.env.RATE_LIMIT_SUBJECT_SECRET = saved;
    }
  });

  it("never leaks the raw ip or full UA into the subject", () => {
    const subject = subjectForAnon("203.0.113.5", ua, noon);
    expect(subject).not.toContain("203.0.113.5");
    expect(subject).not.toContain("Chrome");
    expect(subject).toMatch(/^anon:[0-9a-f]{64}$/);
  });
});

describe("register (DESIGN §9: Spanish, usted)", () => {
  // Blacklist the second-person forms these messages could plausibly slip
  // into — voseo, tuteo imperatives, tuteo possessives — rather than a general
  // "verb ends in an accented vowel" heuristic, which fires on `de las …`.
  const NOT_USTED =
    /\b(alcanzaste|alcanzás|iniciá|inicias?|volvé|vuelve|intentá|intenta|escribí|escribe|revisá|revisa|esperá|espera|tenés|tienes|podés|puedes|querés|quieres|debés|debes|tu|tus|te|ti|tuyo)\b/i;
  const resetAt = new Date("2026-01-02T00:00:00Z");

  it.each([
    ["unavailable", RATE_LIMIT_UNAVAILABLE_MESSAGE],
    ["anon limit", rateLimitReachedMessage("anon", resetAt)],
    ["authed limit", rateLimitReachedMessage("authed", resetAt)],
  ])("%s message addresses the reader as usted", (_name, message) => {
    expect(message).not.toMatch(NOT_USTED);
  });

  it("does not double the period after a p. m. reset time", () => {
    // 6 p.m. CR — Intl renders "6:00 p. m.", already sentence-final.
    const message = rateLimitReachedMessage("anon", resetAt);
    expect(message).toContain("p. m.");
    expect(message).not.toContain("..");
  });
});

describe("checkRateLimit — fake client", () => {
  it("allows when the incremented count is within the limit", async () => {
    const client = fakeClient({ count: 1 });
    const result = await checkRateLimit("user:1", "authed", client);
    expect(result.allowed).toBe(true);
    expect(result.reason).toBe("ok");
    expect(result.message).toBeNull();
    expect(result.remaining).toBe(49);
  });

  it("denies once the incremented count exceeds the limit, naming the reset time and nudging sign-in for anon", async () => {
    const client = fakeClient({ count: 11 });
    const result = await checkRateLimit("anon:x", "anon", client);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("rate_limited");
    expect(result.remaining).toBe(0);
    expect(result.message).toMatch(/límite/);
    expect(result.message).toMatch(/las \d/); // names the reset time
    expect(result.message).toMatch(/Inicie sesión/);
  });

  it("does not nudge sign-in for the authed tier", async () => {
    const client = fakeClient({ count: 51 });
    const result = await checkRateLimit("user:1", "authed", client);
    expect(result.allowed).toBe(false);
    expect(result.message).not.toMatch(/Inicie sesión/);
  });

  it("fails closed with the generic message when the RPC returns an error", async () => {
    const client = fakeClient(null, { message: "connection refused" });
    const result = await checkRateLimit("anon:x", "anon", client);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("unavailable");
    expect(result.remaining).toBe(0);
    expect(result.message).toBe(RATE_LIMIT_UNAVAILABLE_MESSAGE);
  });

  it("fails closed when the RPC call throws", async () => {
    const client: RpcClient = {
      rpc: async () => {
        throw new Error("boom");
      },
    };
    const result = await checkRateLimit("anon:x", "anon", client);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("unavailable");
  });

  it("fails closed when SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are unset", async () => {
    const savedUrl = process.env.SUPABASE_URL;
    const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const result = await checkRateLimit("anon:x", "anon");
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe("unavailable");
      expect(result.message).toBe(RATE_LIMIT_UNAVAILABLE_MESSAGE);
    } finally {
      if (savedUrl !== undefined) process.env.SUPABASE_URL = savedUrl;
      if (savedKey !== undefined)
        process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey;
    }
  });

  it("resetAt is the next Costa Rica midnight — 06:00 UTC", async () => {
    const client = fakeClient({ count: 1 });
    const result = await checkRateLimit("user:1", "authed", client);
    expect(result.resetAt.getUTCHours()).toBe(6);
    expect(result.resetAt.getUTCMinutes()).toBe(0);
    expect(result.resetAt.getUTCSeconds()).toBe(0);
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
  });
});

describe("checkRateLimit — the window is a Costa Rica calendar day", () => {
  /** Captures the window the RPC was actually asked to increment. */
  function capturingClient(): {
    client: RpcClient;
    windowStarts: string[];
    cutoffs: string[];
  } {
    const windowStarts: string[] = [];
    const cutoffs: string[] = [];
    return {
      windowStarts,
      cutoffs,
      client: {
        rpc: async (_fn, args) => {
          windowStarts.push(args.p_window_start);
          cutoffs.push(args.p_cutoff);
          return { data: { count: 1 }, error: null };
        },
      },
    };
  }

  it("holds one window across UTC midnight and flips at CR midnight", async () => {
    const { client, windowStarts } = capturingClient();
    // 23:59 UTC and 00:01 UTC are the same CR day; 06:01 UTC is the next one.
    await checkRateLimit(
      "user:1",
      "authed",
      client,
      new Date("2026-08-11T23:59:00Z"),
    );
    await checkRateLimit(
      "user:1",
      "authed",
      client,
      new Date("2026-08-12T00:01:00Z"),
    );
    await checkRateLimit(
      "user:1",
      "authed",
      client,
      new Date("2026-08-12T06:01:00Z"),
    );
    expect(windowStarts[0]).toBe("2026-08-11T06:00:00.000Z");
    expect(windowStarts[1]).toBe("2026-08-11T06:00:00.000Z");
    expect(windowStarts[2]).toBe("2026-08-12T06:00:00.000Z");
  });

  it("applies to the anon tier too, and keeps the cutoff a whole retention window behind", async () => {
    const { client, windowStarts, cutoffs } = capturingClient();
    const result = await checkRateLimit(
      "anon:x",
      "anon",
      client,
      new Date("2026-08-12T05:59:00Z"),
    );
    expect(windowStarts[0]).toBe("2026-08-11T06:00:00.000Z");
    expect(cutoffs[0]).toBe("2026-08-09T06:00:00.000Z");
    expect(result.resetAt.toISOString()).toBe("2026-08-12T06:00:00.000Z");
  });
});

describe("rateLimitReachedMessage", () => {
  it("names a reset time in Costa Rica local time, not raw UTC", () => {
    const resetAt = new Date("2026-07-24T00:00:00Z"); // midnight UTC = 6pm CR (UTC-6)
    const msg = rateLimitReachedMessage("authed", resetAt);
    expect(msg).toMatch(/6:00\s*p\.?\s*m\.?/i);
  });
});

const hasLocalDb =
  !!process.env.SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;

describe.skipIf(!hasLocalDb)("checkRateLimit — integration (Postgres)", () => {
  // Built in beforeAll, not at describe-body scope: skipIf still evaluates the
  // body during collection, and serviceClient throws without SUPABASE_URL (CI).
  let client: SupabaseClient<Database>;
  let rpcClient: RpcClient;

  beforeAll(() => {
    client = serviceClient();
    rpcClient = supabaseRpcClient(client);
  });

  async function cleanup(subject: string) {
    await client.from("rate_limits").delete().eq("subject", subject);
  }

  it("allows the 10th anon call and denies the 11th", async () => {
    process.env.RATE_LIMIT_ANON = "10";
    const subject = subjectForAnon(`itest-${randomUUID()}`, "Chrome/120");
    try {
      const results: RateLimitResult[] = [];
      for (let i = 0; i < 11; i++) {
        results.push(await checkRateLimit(subject, "anon", rpcClient));
      }
      expect(results.slice(0, 10).every((r) => r.allowed)).toBe(true);
      expect(results[9].remaining).toBe(0);
      expect(results[10].allowed).toBe(false);
      expect(results[10].reason).toBe("rate_limited");
    } finally {
      delete process.env.RATE_LIMIT_ANON;
      await cleanup(subject);
    }
  });

  it("enforces the authed tier's own limit, independent of the anon tier", async () => {
    process.env.RATE_LIMIT_AUTHED = "2";
    const subject = subjectForUser(`itest-${randomUUID()}`);
    try {
      const r1 = await checkRateLimit(subject, "authed", rpcClient);
      const r2 = await checkRateLimit(subject, "authed", rpcClient);
      const r3 = await checkRateLimit(subject, "authed", rpcClient);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
      expect(r3.allowed).toBe(false);
    } finally {
      delete process.env.RATE_LIMIT_AUTHED;
      await cleanup(subject);
    }
  });

  it("rolls the window over instead of accumulating a stale count", async () => {
    process.env.RATE_LIMIT_ANON = "10";
    const subject = `itest:${randomUUID()}`;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    await client
      .from("rate_limits")
      .upsert({ subject, window_start: yesterday, count: 999 });
    try {
      const result = await checkRateLimit(subject, "anon", rpcClient);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      const { data } = await client
        .from("rate_limits")
        .select("count")
        .eq("subject", subject)
        .single();
      expect(data?.count).toBe(1);
    } finally {
      delete process.env.RATE_LIMIT_ANON;
      await cleanup(subject);
    }
  });

  it("fails closed when the database is unreachable", async () => {
    const badClient = supabaseRpcClient(
      createClient<Database>("http://127.0.0.1:9", "irrelevant", {
        auth: { persistSession: false },
      }),
    );
    const result = await checkRateLimit("anon:unreachable", "anon", badClient);
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("unavailable");
    expect(result.message).toBe(RATE_LIMIT_UNAVAILABLE_MESSAGE);
  });

  it("stores a hashed subject with no raw IP or UA substring", async () => {
    const ip = "198.51.100.77";
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    const subject = subjectForAnon(ip, ua);
    try {
      await checkRateLimit(subject, "anon", rpcClient);
      const { data } = await client
        .from("rate_limits")
        .select("subject")
        .eq("subject", subject)
        .single();
      expect(data?.subject).toBeDefined();
      expect(data?.subject).not.toContain(ip);
      expect(data?.subject).not.toContain("Chrome");
    } finally {
      await cleanup(subject);
    }
  });

  it("deletes rows past the retention window opportunistically", async () => {
    const staleSubject = `itest:stale:${randomUUID()}`;
    const freshSubject = `itest:fresh:${randomUUID()}`;
    const staleWindow = new Date(
      Date.now() - 3 * 24 * 60 * 60 * 1000,
    ).toISOString();
    await client
      .from("rate_limits")
      .upsert({ subject: staleSubject, window_start: staleWindow, count: 5 });
    try {
      await checkRateLimit(freshSubject, "anon", rpcClient);
      const { data } = await client
        .from("rate_limits")
        .select("subject")
        .eq("subject", staleSubject)
        .maybeSingle();
      expect(data).toBeNull();
    } finally {
      await cleanup(staleSubject);
      await cleanup(freshSubject);
    }
  });
});
