import { describe, expect, it } from "vitest";

import { ROUTING, routingEntry } from "../src/lib/routing";
import {
  checkRoutingUrls,
  formatReport,
  KNOWN_WARNINGS,
  type Fetcher,
} from "./check-routing-urls";

type Answer =
  | number
  | { status: number; server?: string }
  | { throws: { code?: string; cause?: { code: string } } };

/** A fetcher that answers by URL, or throws where the map says so. */
function fetcherFrom(answers: Record<string, Answer>): Fetcher {
  return async (url) => {
    const answer = answers[url];
    if (answer === undefined) throw new Error(`unexpected fetch of ${url}`);
    if (typeof answer === "object" && "throws" in answer) {
      const error = new Error("fetch failed") as Error & {
        code?: string;
        cause?: unknown;
      };
      if (answer.throws.code) error.code = answer.throws.code;
      if (answer.throws.cause) error.cause = answer.throws.cause;
      throw error;
    }
    const { status, server } =
      typeof answer === "number" ? { status: answer } : answer;
    return {
      status,
      headers: {
        get: (name: string) => (name === "server" ? (server ?? null) : null),
      },
    };
  };
}

const ALL_OK: Record<string, Answer> = Object.fromEntries(
  ROUTING.map((entry) => [entry.url, 200]),
);

describe("checkRoutingUrls (#264)", () => {
  it("passes when every front door answers 200", async () => {
    const report = await checkRoutingUrls(fetcherFrom(ALL_OK));
    expect(report.failures).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.verdicts.map((v) => v.category)).toEqual(
      ROUTING.map((entry) => entry.category),
    );
  });

  it("fails a 404, a 5xx and an unreachable portal, naming each", async () => {
    const [gone, down, dns] = ROUTING;
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [gone.url]: 404,
        [down.url]: 503,
        [dns.url]: { throws: { cause: { code: "ENOTFOUND" } } },
      }),
    );
    expect(report.failures.map((v) => [v.category, v.detail])).toEqual([
      [gone.category, "404"],
      [down.category, "503"],
      [dns.category, "ENOTFOUND"],
    ]);
  });

  it("warns, not fails, on a Cloudflare 403 from the portal known for it", async () => {
    const blocked = routingEntry("migracion");
    expect(KNOWN_WARNINGS.migracion).toBe("cloudflare-403");
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [blocked.url]: { status: 403, server: "cloudflare" },
      }),
    );
    expect(report.failures).toEqual([]);
    expect(report.warnings.map((v) => v.category)).toEqual(["migracion"]);
    expect(report.warnings[0].detail).toContain("Cloudflare");
  });

  it("fails a Cloudflare 403 on any other portal — a new WAF policy is news", async () => {
    const other = routingEntry("hacienda");
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [other.url]: { status: 403, server: "cloudflare" },
      }),
    );
    expect(report.warnings).toEqual([]);
    expect(report.failures.map((v) => v.category)).toEqual(["hacienda"]);
    expect(report.failures[0].detail).toContain("not expected here");
  });

  it("still fails a 403 that is not Cloudflare's", async () => {
    const [forbidden] = ROUTING;
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [forbidden.url]: { status: 403, server: "nginx" },
      }),
    );
    expect(report.failures.map((v) => v.category)).toEqual([
      forbidden.category,
    ]);
  });

  it("warns, not fails, on an incomplete certificate chain from the portal known for it", async () => {
    const chain = routingEntry("meic");
    expect(KNOWN_WARNINGS.meic).toBe("incomplete-chain");
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [chain.url]: {
          throws: { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } },
        },
      }),
    );
    expect(report.failures).toEqual([]);
    expect(report.warnings.map((v) => v.category)).toEqual(["meic"]);
    expect(report.warnings[0].detail).toContain(
      "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    );
  });

  it("fails an incomplete chain on any other portal — a regression, not a known quirk", async () => {
    const other = routingEntry("ccss");
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [other.url]: {
          throws: { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } },
        },
      }),
    );
    expect(report.warnings).toEqual([]);
    expect(report.failures.map((v) => v.category)).toEqual(["ccss"]);
  });

  it("fails every other TLS error — an expired certificate is a dead door", async () => {
    const [expired] = ROUTING;
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [expired.url]: { throws: { cause: { code: "CERT_HAS_EXPIRED" } } },
      }),
    );
    expect(report.failures.map((v) => v.detail)).toEqual(["CERT_HAS_EXPIRED"]);
  });

  it("fetches with GET and follows redirects — HEAD is refused by some portals", async () => {
    const seen: string[] = [];
    await checkRoutingUrls(async (url, init) => {
      seen.push(`${init.method} ${init.redirect} ${url}`);
      return { status: 200, headers: { get: () => null } };
    });
    for (const entry of ROUTING) {
      expect(seen).toContain(`GET follow ${entry.url}`);
    }
  });

  it("formats a line per URL, with the detail on anything but ok", async () => {
    const [first, second] = ROUTING;
    const report = await checkRoutingUrls(
      fetcherFrom({
        ...ALL_OK,
        [first.url]: 503,
        [routingEntry("migracion").url]: { status: 403, server: "cloudflare" },
      }),
    );
    const lines = formatReport(report).split("\n");
    expect(lines).toHaveLength(ROUTING.length);
    expect(lines[0]).toMatch(new RegExp(`^FAIL ${first.category}.*→ 503$`));
    expect(lines.find((l) => l.includes("migracion"))).toMatch(
      /^WARN migracion.*Cloudflare/,
    );
    expect(lines[1]).toMatch(new RegExp(`^ok {3}${second.category}`));
    expect(lines[1]).not.toContain("→");
  });
});
