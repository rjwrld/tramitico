import type { NextRequest } from "next/server";

/**
 * POST /api/csp-report — the reporting destination for the report-only policy
 * set in `next.config.ts` (#137). Reports are logged, nothing is stored: the
 * signal we need before promoting the CSP to enforced is "does the happy path
 * violate it", which the platform log answers for free.
 *
 * Two wire shapes arrive here — the legacy `report-uri` envelope
 * (`{"csp-report": {...}}`, `application/csp-report`) and the Reporting API
 * batch (`[{type, body}, ...]`, `application/reports+json`). Both are logged
 * as-is; the body is untrusted input, so it is never parsed for meaning.
 */
export async function POST(request: NextRequest) {
  try {
    const report = await request.json();
    console.warn("[csp-report]", JSON.stringify(report));
  } catch {
    // A malformed or empty body is a client problem, not ours — a report
    // endpoint that 500s would only add noise to the browser console.
    console.warn("[csp-report] unparsable report body");
  }

  return new Response(null, { status: 204 });
}
