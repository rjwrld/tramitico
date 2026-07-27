import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  coarseUserAgent,
  rateLimitReachedMessage,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  subjectForAnon,
  subjectForUser,
  supabaseRpcClient,
  type RateLimitResult,
  type RpcClient,
} from "./rate-limit";
import type { Database } from "./database.types";

function loadDotEnvLocal() {
  const file = path.resolve(__dirname, "../../.env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadDotEnvLocal();

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

describe("subjectForAnon", () => {
  const ua = "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36";

  it("is stable for the same ip + UA family", () => {
    expect(subjectForAnon("203.0.113.5", ua)).toBe(
      subjectForAnon("203.0.113.5", ua),
    );
  });

  it("differs across IPs", () => {
    expect(subjectForAnon("203.0.113.5", ua)).not.toBe(
      subjectForAnon("203.0.113.6", ua),
    );
  });

  it("never leaks the raw ip or full UA into the subject", () => {
    const subject = subjectForAnon("203.0.113.5", ua);
    expect(subject).not.toContain("203.0.113.5");
    expect(subject).not.toContain("Chrome");
    expect(subject).toMatch(/^anon:[0-9a-f]{64}$/);
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
    expect(result.message).toMatch(/Iniciá sesión/);
  });

  it("does not nudge sign-in for the authed tier", async () => {
    const client = fakeClient({ count: 51 });
    const result = await checkRateLimit("user:1", "authed", client);
    expect(result.allowed).toBe(false);
    expect(result.message).not.toMatch(/Iniciá sesión/);
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

  it("resetAt is the next UTC midnight", async () => {
    const client = fakeClient({ count: 1 });
    const result = await checkRateLimit("user:1", "authed", client);
    expect(result.resetAt.getUTCHours()).toBe(0);
    expect(result.resetAt.getUTCMinutes()).toBe(0);
    expect(result.resetAt.getUTCSeconds()).toBe(0);
    expect(result.resetAt.getTime()).toBeGreaterThan(Date.now());
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
  // body during collection, and createClient throws without SUPABASE_URL (CI).
  let client: ReturnType<typeof createClient<Database>>;
  let rpcClient: RpcClient;

  beforeAll(() => {
    client = createClient<Database>(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false } },
    );
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
