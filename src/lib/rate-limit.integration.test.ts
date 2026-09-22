/**
 * `checkRateLimit` against a real Postgres (issue #125): the counter, the
 * window rollover, the fail-closed path and the retention sweep, asserted
 * against the `check_rate_limit` RPC rather than a fake client.
 *
 * Gated on a database through the shared helper — skipped locally without
 * credentials, failed loudly on CI (issue #129).
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  checkRateLimit,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  subjectForAnon,
  subjectForAnonIp,
  subjectForUser,
  supabaseRpcClient,
  type RateLimitResult,
  type RpcClient,
} from "./rate-limit";
import type { Database } from "./database.types";
import { serviceClient } from "./supabase/service";
import { envPrereqs, integrationSuite } from "./test-support/suite-gate";

// Required in production (#125); irrelevant to every assertion here.
process.env.RATE_LIMIT_SUBJECT_SECRET ??= "test-subject-secret";

const describeDb = integrationSuite(
  envPrereqs("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"),
);

describeDb("checkRateLimit — integration (Postgres)", () => {
  // Built in beforeAll, not at describe-body scope: the local skip path still
  // evaluates the body during collection, and serviceClient throws without
  // SUPABASE_URL.
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

  /** The subject's current counter, or null when it has no row. */
  async function countOf(subject: string): Promise<number | null> {
    const { data } = await client
      .from("rate_limits")
      .select("count")
      .eq("subject", subject)
      .maybeSingle();
    return data?.count ?? null;
  }

  describe("refund (#126)", () => {
    it("gives the ask back — the counter returns to where it was", async () => {
      const subject = `itest:${randomUUID()}`;
      try {
        await checkRateLimit(subject, "authed", rpcClient);
        const second = await checkRateLimit(subject, "authed", rpcClient);
        expect(await countOf(subject)).toBe(2);
        await second.refund();
        expect(await countOf(subject)).toBe(1);
      } finally {
        await cleanup(subject);
      }
    });

    it("never drives the counter negative", async () => {
      const subject = `itest:${randomUUID()}`;
      try {
        const first = await checkRateLimit(subject, "authed", rpcClient);
        await first.refund();
        expect(await countOf(subject)).toBe(0);
        // A second, independent refund of an already-empty window: the clamp
        // in the RPC is what stops a refund path from minting free asks.
        const stale = await checkRateLimit(subject, "authed", rpcClient);
        await stale.refund();
        await stale.refund();
        const extra = await checkRateLimit(subject, "authed", rpcClient);
        await extra.refund();
        expect(await countOf(subject)).toBeGreaterThanOrEqual(0);
      } finally {
        await cleanup(subject);
      }
    });

    it("keeps the counter consistent under concurrent asks and refunds", async () => {
      const subject = `itest:${randomUUID()}`;
      try {
        // 6 asks in flight, 2 of them refunded concurrently with the rest.
        const checks = await Promise.all(
          Array.from({ length: 6 }, () =>
            checkRateLimit(subject, "authed", rpcClient),
          ),
        );
        await Promise.all([
          checks[0].refund(),
          checks[1].refund(),
          checkRateLimit(subject, "authed", rpcClient),
        ]);
        // 7 increments, 2 refunds — no lost update in either direction.
        expect(await countOf(subject)).toBe(5);
      } finally {
        await cleanup(subject);
      }
    });

    it("does not touch the new day's quota once the window has rolled over", async () => {
      const subject = `itest:${randomUUID()}`;
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      try {
        // A check taken yesterday, refunded after today's window opened.
        const stale = await checkRateLimit(
          subject,
          "authed",
          rpcClient,
          yesterday,
        );
        await checkRateLimit(subject, "authed", rpcClient);
        expect(await countOf(subject)).toBe(1); // today's window, reset to 1
        await stale.refund();
        expect(await countOf(subject)).toBe(1); // untouched
      } finally {
        await cleanup(subject);
      }
    });
  });

  describe("the per-IP umbrella (#383)", () => {
    // A private-range IP no request ever forwards, so the umbrella row can
    // only be this suite's — and a fresh one per test, since the digest is
    // date-scoped and the rows outlive a run.
    const ip = () => `itest-${randomUUID()}`;
    const CHROME = "Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0 Safari/537.36";
    const FIREFOX = "Mozilla/5.0 Windows NT 10.0 Gecko/20100101 Firefox/121.0";

    it("lands the extra row beside the subject's, and the refund gives both back", async () => {
      const addr = ip();
      const subject = subjectForAnon(addr, CHROME);
      const umbrella = subjectForAnonIp(addr);
      try {
        const result = await checkRateLimit(
          subject,
          "anon",
          rpcClient,
          undefined,
          umbrella,
        );
        expect(result.allowed).toBe(true);
        expect(await countOf(subject)).toBe(1);
        expect(await countOf(umbrella)).toBe(1);
        await result.refund();
        expect(await countOf(subject)).toBe(0);
        expect(await countOf(umbrella)).toBe(0);
      } finally {
        await cleanup(subject);
        await cleanup(umbrella);
      }
    });

    it("denies a second family once the IP's shared ceiling is spent", async () => {
      process.env.RATE_LIMIT_ANON = "2";
      process.env.RATE_LIMIT_ANON_IP = "3";
      const addr = ip();
      const chrome = subjectForAnon(addr, CHROME);
      const firefox = subjectForAnon(addr, FIREFOX);
      const umbrella = subjectForAnonIp(addr);
      try {
        const c1 = await checkRateLimit(
          chrome,
          "anon",
          rpcClient,
          undefined,
          umbrella,
        );
        const c2 = await checkRateLimit(
          chrome,
          "anon",
          rpcClient,
          undefined,
          umbrella,
        );
        const f1 = await checkRateLimit(
          firefox,
          "anon",
          rpcClient,
          undefined,
          umbrella,
        );
        const f2 = await checkRateLimit(
          firefox,
          "anon",
          rpcClient,
          undefined,
          umbrella,
        );
        expect([c1, c2, f1].every((r) => r.allowed)).toBe(true);
        expect(f2.allowed).toBe(false);
        expect(f2.reason).toBe("rate_limited");
        expect(f2.counter).toBe("ip");
        // Firefox had one of its own two left; the umbrella is what said no.
        expect(await countOf(firefox)).toBe(2);
        expect(await countOf(umbrella)).toBe(4);
      } finally {
        delete process.env.RATE_LIMIT_ANON;
        delete process.env.RATE_LIMIT_ANON_IP;
        await cleanup(chrome);
        await cleanup(firefox);
        await cleanup(umbrella);
      }
    });

    it("is swept with the rest once it is past retention", async () => {
      const stale = `anon-ip:stale:${randomUUID()}`;
      const staleWindow = new Date(
        Date.now() - 3 * 24 * 60 * 60 * 1000,
      ).toISOString();
      await client
        .from("rate_limits")
        .upsert({ subject: stale, window_start: staleWindow, count: 5 });
      const addr = ip();
      const subject = subjectForAnon(addr, CHROME);
      const umbrella = subjectForAnonIp(addr);
      try {
        await checkRateLimit(subject, "anon", rpcClient, undefined, umbrella);
        expect(await countOf(stale)).toBeNull();
      } finally {
        await cleanup(stale);
        await cleanup(subject);
        await cleanup(umbrella);
      }
    });
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
