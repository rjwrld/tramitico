import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkRateLimit,
  coarseUserAgent,
  crDate,
  rateLimitReachedMessage,
  RATE_LIMIT_UNAVAILABLE_MESSAGE,
  subjectForAnon,
  subjectForUser,
  type RpcClient,
} from "./rate-limit";

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
  // The fail-closed cases below log now (#208); the assertions on that line
  // live in their own suite, and here the spy only keeps the output clean.
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
          if ("p_cutoff" in args) cutoffs.push(args.p_cutoff);
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

describe("checkRateLimit — refund (#126)", () => {
  /** Records every RPC the check and its refund make. */
  function recordingClient(
    count = 1,
    refundResult: {
      data: { count: number } | null;
      error: { message: string } | null;
    } = { data: { count: 0 }, error: null },
  ): { client: RpcClient; calls: { fn: string; args: unknown }[] } {
    const calls: { fn: string; args: unknown }[] = [];
    return {
      calls,
      client: {
        rpc: async (fn, args) => {
          calls.push({ fn, args });
          return fn === "rate_limit_refund"
            ? refundResult
            : { data: { count }, error: null };
        },
      },
    };
  }

  const noon = new Date("2026-08-12T18:00:00Z");

  it("gives the ask back against the same row the increment consumed", async () => {
    const { client, calls } = recordingClient();
    const result = await checkRateLimit("user:1", "authed", client, noon);
    await result.refund();

    expect(calls.map((c) => c.fn)).toEqual([
      "rate_limit_increment",
      "rate_limit_refund",
    ]);
    // Same subject, same window — never a second window derived at refund time.
    expect(calls[1].args).toEqual({
      p_subject: "user:1",
      p_window_start: "2026-08-12T06:00:00.000Z",
    });
  });

  it("is once-only — both stream-error doors can call it without double-refunding", async () => {
    const { client, calls } = recordingClient();
    const result = await checkRateLimit("user:1", "authed", client, noon);
    await result.refund();
    await result.refund();
    await result.refund();
    expect(calls.filter((c) => c.fn === "rate_limit_refund")).toHaveLength(1);
  });

  it("refunds nothing when the limiter denied the ask", async () => {
    const { client, calls } = recordingClient(51);
    const result = await checkRateLimit("user:1", "authed", client, noon);
    expect(result.allowed).toBe(false);
    await result.refund();
    expect(calls.map((c) => c.fn)).toEqual(["rate_limit_increment"]);
  });

  it("refunds nothing when the limiter was unavailable — no increment landed", async () => {
    const client = fakeClient(null, { message: "connection refused" });
    const result = await checkRateLimit("anon:x", "anon", client, noon);
    expect(result.reason).toBe("unavailable");
    // The whole point: this must not decrement a row this call never touched.
    await expect(result.refund()).resolves.toBeUndefined();
  });

  it("swallows an RPC error — a failed refund must not break the response", async () => {
    const { client } = recordingClient(1, {
      data: null,
      error: { message: "connection refused" },
    });
    const result = await checkRateLimit("user:1", "authed", client, noon);
    await expect(result.refund()).resolves.toBeUndefined();
  });

  it("swallows a thrown RPC too", async () => {
    const client: RpcClient = {
      rpc: async (fn) => {
        if (fn === "rate_limit_refund") throw new Error("boom");
        return { data: { count: 1 }, error: null };
      },
    };
    const result = await checkRateLimit("user:1", "authed", client, noon);
    await expect(result.refund()).resolves.toBeUndefined();
  });

  it("treats a no-op refund (window already rolled over) as success", async () => {
    // maybeSingle() over zero matched rows: no data, no error.
    const { client } = recordingClient(1, { data: null, error: null });
    const result = await checkRateLimit("user:1", "authed", client, noon);
    await expect(result.refund()).resolves.toBeUndefined();
  });

  it("gives each concurrent ask its own refund, not a shared one", async () => {
    const { client, calls } = recordingClient();
    const [a, b] = await Promise.all([
      checkRateLimit("user:1", "authed", client, noon),
      checkRateLimit("user:1", "authed", client, noon),
    ]);
    await Promise.all([a.refund(), b.refund()]);
    expect(calls.filter((c) => c.fn === "rate_limit_refund")).toHaveLength(2);
  });
});

describe("rateLimitReachedMessage", () => {
  it("names a reset time in Costa Rica local time, not raw UTC", () => {
    const resetAt = new Date("2026-07-24T00:00:00Z"); // midnight UTC = 6pm CR (UTC-6)
    const msg = rateLimitReachedMessage("authed", resetAt);
    expect(msg).toMatch(/6:00\s*p\.?\s*m\.?/i);
  });
});

/**
 * #208: `telemetry.ts` leaves the ask event's `providerError` empty on this
 * door because "the rate-limit path already logged its own reason". This
 * suite is what makes that sentence true.
 */
describe("checkRateLimit — the unavailable log line", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs exactly one describeError line when the RPC returns an error", async () => {
    const client = fakeClient(null, { message: "connection refused" });

    await checkRateLimit("anon:x", "anon", client);

    expect(console.error).toHaveBeenCalledTimes(1);
    // The RPC's own error object is what gets thrown, and a PostgREST error
    // is a plain object — its identity is all `describeError` can name.
    expect(console.error).toHaveBeenCalledWith(
      "rate limit: unavailable — error=Object",
    );
  });

  it("names the identity of a thrown Postgres-shaped error", async () => {
    const client: RpcClient = {
      rpc: async () => {
        throw Object.assign(new Error('relation "rate_limits" is missing'), {
          code: "42P01",
        });
      },
    };

    await checkRateLimit("anon:x", "anon", client);

    expect(console.error).toHaveBeenCalledWith(
      "rate limit: unavailable — error=Error#42P01",
    );
  });

  it("never puts the error's own message in the line", async () => {
    const client = fakeClient(null, {
      message: "row: ¿cómo declaro el D-101?",
    });

    await checkRateLimit("anon:x", "anon", client);

    expect(vi.mocked(console.error).mock.calls.flat().join("\n")).not.toContain(
      "D-101",
    );
  });

  it("stays quiet when the limiter answers", async () => {
    await checkRateLimit("anon:x", "anon", fakeClient({ count: 1 }));

    expect(console.error).not.toHaveBeenCalled();
  });
});
