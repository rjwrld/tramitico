import type { NextConfig } from "next";

/**
 * Baseline security headers (#137).
 *
 * These live in `next.config.ts` rather than the middleware on purpose: #140
 * rewrites the middleware surface onto the proxy convention, and the matcher
 * there deliberately skips static assets. `headers()` covers every response —
 * pages, route handlers, and `/_next/static` — and stays out of #140's way.
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
 * Report-only for now. `script-src` cannot drop `'unsafe-inline'` while the
 * policy is static: the App Router streams its RSC payload through inline
 * `<script>` tags and next-themes injects one more, and neither is hashable.
 * Promotion to enforced runs through a per-request nonce set in the proxy
 * layer once #140 lands — criteria recorded on #121.
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
    // Enforces nothing under Report-Only — X-Frame-Options below is the live
    // clickjacking control. Kept here so promotion exercises it first.
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
    // Vercel sets HSTS on custom domains, but stating it here makes the header
    // ours to verify. Browsers ignore it over plain http, so local is unaffected.
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains",
  },
  { key: "Reporting-Endpoints", value: 'csp-endpoint="/api/csp-report"' },
  {
    key: "Content-Security-Policy-Report-Only",
    value: contentSecurityPolicy(),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
