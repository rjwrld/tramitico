import type { NextRequest } from "next/server";

import { REDACTED } from "@/lib/log-redaction";

/**
 * POST /api/csp-report — the reporting destination for the policy set in
 * `next.config.ts` (#137, enforced since #121's coverage pass). Reports are
 * logged, nothing is stored: the signal is "does the happy path violate it",
 * which the platform log answers for free — and under enforcement a report is
 * also a page that broke for someone, so a violation line is a bug report.
 *
 * This endpoint is unauthenticated and advertised on every response via
 * `Reporting-Endpoints`, so its body is attacker-controlled text arriving at
 * an operational log — the one thing `log-redaction.ts` promises never
 * happens (#208). So nothing here is logged as it arrived. The body is size
 * capped before it is read, three fields are lifted out of it, and each is
 * reduced to a shape that cannot carry prose: a directive name, an origin, a
 * path. Everything else — the rest of the report, a malformed one, a body
 * that is not JSON — is dropped against a content-free counter line.
 *
 * Two wire shapes arrive here — the legacy `report-uri` envelope
 * (`{"csp-report": {...}}`, `application/csp-report`) and the Reporting API
 * batch (`[{type, body}, ...]`, `application/reports+json`), whose field
 * names are camelCase. Both are read; neither is trusted.
 *
 * No in-process tally here, unlike the detail lines in `answer/` and
 * `retrieval-degraded.ts`: those count our own failures, and a counter a
 * stranger can drive at will is not a signal worth holding in memory. The
 * log line is the whole record.
 */

/** Bigger than any real report, small enough to be free to hold in memory. */
const MAX_BODY_BYTES = 8 * 1024;

/** A batch past this is not a browser reporting; the excess is dropped. */
const MAX_REPORTS = 10;

/** CSP directive names: lowercase ASCII words, `-` separated. */
const DIRECTIVE = /^[a-z][a-z0-9-]{0,39}$/;

/**
 * `blocked-uri` is not always a URL. These are the spec's non-URL values,
 * and they are the only free-standing tokens allowed through verbatim.
 */
const BLOCKED_KEYWORDS = new Set([
  "inline",
  "eval",
  "self",
  "data",
  "blob",
  "filesystem",
  "wasm-eval",
  "trusted-types-policy",
  "trusted-types-sink",
]);

/** How much of a path is worth keeping. Longer is truncated, not redacted. */
const MAX_PATH = 120;

/**
 * What a path may be made of. `pathname` is percent-encoded, so it can never
 * break the line it is logged on — but `/%C2%BFmi%20pregunta%3F` is still
 * prose, and this endpoint takes any URL a caller invents. So a path is
 * logged only when it looks like one of ours: unreserved characters and `/`.
 */
const PATH = /^[A-Za-z0-9._~/-]*$/;

type Report = Record<string, unknown>;

/** Distinguishes "the read failed" from "the body was too big" (`null`). */
const UNREADABLE: unique symbol = Symbol("unreadable");

/** Reads the body with a hard byte cap; null when there is more than that. */
async function readCappedBody(request: NextRequest): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return null;

  const stream = request.body;
  if (stream === null) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) return null;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    void reader.cancel().catch(() => {});
  }
  return text + decoder.decode();
}

function isReport(value: unknown): value is Report {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The reports inside either envelope. An empty list means "nothing here we
 * recognise" — indistinguishable, deliberately, from a malformed body.
 */
function reportsIn(payload: unknown): Report[] {
  if (Array.isArray(payload)) {
    return (
      payload
        .slice(0, MAX_REPORTS)
        .filter(isReport)
        // The batch carries every report type the browser has for us; only the
        // CSP ones have the fields below, and the rest are none of our business.
        .filter((entry) => entry.type === "csp-violation")
        .map((entry) => entry.body)
        .filter(isReport)
    );
  }
  if (isReport(payload)) {
    const legacy = payload["csp-report"];
    if (isReport(legacy)) return [legacy];
  }
  return [];
}

function field(report: Report, ...names: string[]): unknown {
  for (const name of names) {
    const value = report[name];
    if (value !== undefined) return value;
  }
  return undefined;
}

function directiveOf(report: Report): string {
  const value = field(
    report,
    "effective-directive",
    "effectiveDirective",
    "violated-directive",
    "violatedDirective",
  );
  if (typeof value !== "string") return REDACTED;
  // `violated-directive` carries the whole policy line ("script-src 'self'");
  // the directive name is its first token, and the rest is policy text.
  const name = value.split(" ", 1)[0];
  return DIRECTIVE.test(name) ? name : REDACTED;
}

/** The origin a blocked load came from — never its path, never its query. */
function blockedOf(report: Report): string {
  const value = field(report, "blocked-uri", "blockedURI", "blockedURL");
  if (typeof value !== "string" || value === "") return REDACTED;
  if (BLOCKED_KEYWORDS.has(value)) return value;
  try {
    const { origin, protocol } = new URL(value);
    // An opaque origin ("null") says as much as we can honestly say; a
    // scheme with no origin (`data:`, `javascript:`) is named by scheme.
    return origin === "null" ? protocol.replace(":", "") : origin;
  } catch {
    return REDACTED;
  }
}

/** The page's path, with query and fragment — which carry input — dropped. */
function documentOf(report: Report): string {
  const value = field(report, "document-uri", "documentURI", "documentURL");
  if (typeof value !== "string" || value === "") return REDACTED;
  try {
    const path = new URL(value).pathname;
    if (!PATH.test(path)) return REDACTED;
    return path.length > MAX_PATH ? `${path.slice(0, MAX_PATH)}…` : path;
  } catch {
    return REDACTED;
  }
}

/**
 * Records one report. The prefix is load-bearing: it is what a log-based
 * counter will match on, so it is a constant string with the variables tacked
 * on as `key=value`, not an interpolated sentence.
 */
function recordViolation(report: Report): void {
  console.warn(
    `[csp-report] violation — directive=${directiveOf(report)} ` +
      `blocked=${blockedOf(report)} document=${documentOf(report)}`,
  );
}

/** Same, for everything we refused to read. `reason` is ours, not theirs. */
function recordDropped(
  reason: "oversized" | "unreadable" | "unparsable" | "malformed",
): void {
  console.warn(`[csp-report] dropped — reason=${reason}`);
}

export async function POST(request: NextRequest) {
  // The two ways the body never arrives are worth telling apart: `oversized`
  // is someone sending too much, `unreadable` is a socket giving up.
  const body: string | null | typeof UNREADABLE = await readCappedBody(
    request,
  ).catch(() => UNREADABLE);
  if (body === null || body === UNREADABLE) {
    recordDropped(body === UNREADABLE ? "unreadable" : "oversized");
    return new Response(null, { status: 204 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    // A malformed or empty body is a client problem, not ours — a report
    // endpoint that 500s would only add noise to the browser console.
    recordDropped("unparsable");
    return new Response(null, { status: 204 });
  }

  const reports = reportsIn(payload);
  if (reports.length === 0) recordDropped("malformed");
  else for (const report of reports) recordViolation(report);

  return new Response(null, { status: 204 });
}
