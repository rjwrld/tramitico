import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import { describe, expect, it } from "vitest";

import { config } from "./proxy";

/**
 * Compiles the matcher with Next's own path-to-regexp wrapper (the same
 * grammar `tryToParsePath` applies to `config.matcher`), then asks which
 * paths reach the proxy. The
 * session-free public surface must not: `/acerca` is ISR and the sitemap and
 * robots routes are static, so a refreshed session cookie written there would
 * sit on a response the framework labels CDN-cacheable.
 */
const matchers = config.matcher.map((source) => getPathMatch(source));
const reachesProxy = (path: string) =>
  matchers.some((match) => match(path) !== false);

describe("proxy matcher", () => {
  it.each([
    "/",
    "/login",
    "/historial",
    "/privacidad",
    "/api/ask",
    "/api/history",
    "/api/history/abc-123",
    "/api/account/delete",
    "/auth/confirm",
    "/auth/callback",
    "/auth/error",
  ])("runs the session refresh on %s", (path) => {
    expect(reachesProxy(path)).toBe(true);
  });

  it.each([
    "/acerca",
    "/sitemap.xml",
    "/robots.txt",
    "/favicon.ico",
    "/_next/static/chunks/main.js",
    "/_next/image",
    "/icon.png",
    "/og.jpg",
    "/logo.svg",
  ])("skips %s", (path) => {
    expect(reachesProxy(path)).toBe(false);
  });

  it("still covers paths that merely start like an excluded one", () => {
    // The exclusions are anchored: an `acerca` *prefix* is not the page.
    expect(reachesProxy("/acercade")).toBe(true);
    expect(reachesProxy("/acerca/algo")).toBe(true);
  });
});
