import type { NextConfig } from "next";

/**
 * Baseline security headers (#137).
 *
 * These live in `next.config.ts` rather than the proxy on purpose: the proxy
 * matcher (#140) deliberately skips static assets. `headers()` covers every
 * response — pages, route handlers, and `/_next/static` — and stays out of the
 * proxy's way.
 */

/** The Supabase origin the browser talks to (auth + PostgREST), if configured. */
function supabaseOrigin(): string | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Enforced since the 2026-09-17 coverage pass on #121 (report-only from #137
 * until then). `script-src` still carries `'unsafe-inline'`: the App Router
 * streams its RSC payload through inline `<script>` tags and next-themes
 * injects one more, and neither is hashable while the policy is static.
 * Dropping it runs through a per-request nonce set in `src/proxy.ts` — an
 * accepted risk on #121 until that lands, expiring 2026-11-12. Everything
 * else here blocks: a violation is a broken page now, not a log line, so a
 * new origin the browser dials (analytics, error reporting) goes into
 * `connect-src` in the same change that adds it.
 */
function contentSecurityPolicy(): string {
  const supabase = supabaseOrigin();
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase}` : ""}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    // The modern clickjacking control; X-Frame-Options below stays for the
    // browsers that predate it.
    "frame-ancestors 'none'",
    "report-uri /api/csp-report",
    "report-to csp-endpoint",
  ].join("; ");
}

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
  {
    // Set explicitly because there is no production deployment yet (#29) to
    // observe Vercel's own HSTS on, and an unverified platform default is not
    // a control. Ours wins if both are present; the production acceptance pass
    // confirms the emitted max-age matches. Browsers ignore HSTS over plain
    // http, so local and preview are unaffected.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy(),
  },
];

const nextConfig: NextConfig = {
  // No framework fingerprint on responses (#210).
  poweredByHeader: false,
  experimental: {
    // To hand one body to both `src/proxy.ts` and the route, Next holds a copy
    // of it in memory — up to 10 MB by default — before the route reads a
    // byte, and the proxy matches every route that takes a body. None needs
    // more than `/api/ask`'s 32 KiB cap: `/api/csp-report` takes 8, account
    // deletion and the history routes read none, sign-in talks to Supabase
    // from the browser, and there are no Server Actions. Past this limit Next
    // truncates instead of refusing, so it sits at twice the largest route
    // cap and only ever cuts a body its route refuses anyway. A route or
    // Server Action that needs a larger body raises it in the same change;
    // `api/ask/route.test.ts` pins it at or above the ask cap.
    proxyClientMaxBodySize: 64 * 1024,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
