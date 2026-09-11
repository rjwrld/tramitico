/**
 * Verifies every URL in the routing table still serves its front door (#264,
 * decision record on #254 Q3). Runs as a step of the quarterly re-crawl
 * (`.github/workflows/recrawl.yml`): the table is the one place the honest
 * decline and the prompt take an institution's URL from, and a portal that
 * moved is a link the reader follows to a dead page — an operational failure
 * a human classifies, like a document that stopped ingesting.
 *
 * Three verdicts, because two Costa Rican portals taught the first run that
 * "not 200 from a script" and "moved" are different things:
 *
 * - `ok` — answered 200.
 * - `warning` — reachable, but not for *this* client, and *known* to be so
 *   for that portal (`KNOWN_WARNINGS`). A 403 from Cloudflare is the WAF
 *   refusing a non-browser (migracion.go.cr on 2026-09-04); a TLS chain
 *   missing its intermediate is a server misconfiguration every browser
 *   papers over by fetching the issuer itself (meic.go.cr, same day, and
 *   ccpa.or.cr on 2026-09-10). Both are printed, neither fails the step: a
 *   reader's browser gets the page.
 * - `failure` — anything else: DNS gone, 404, 5xx, a timeout — and either
 *   of the two conditions above on a portal not listed for it, so a new WAF
 *   policy or a chain regression elsewhere is not quietly waved through.
 *   That is what a moved or dead portal looks like, and it fails the
 *   re-crawl.
 *
 * `checkRoutingUrls` is the pure part (a `fetch` in, a report out) so the
 * unit lane can pin the verdicts without the network; the CLI at the bottom
 * is the only thing that touches it. A GET rather than a HEAD: several of
 * these portals answer HEAD with 403 or 405 while serving the page fine.
 */
import { ROUTING, type RoutingEntry } from "../src/lib/routing";

export type UrlOutcome = "ok" | "warning" | "failure";

export interface UrlVerdict {
  category: RoutingEntry["category"];
  url: string;
  outcome: UrlOutcome;
  /** What the portal answered, or why the fetch threw, for the log line. */
  detail: string;
}

export interface UrlReport {
  verdicts: UrlVerdict[];
  warnings: UrlVerdict[];
  failures: UrlVerdict[];
}

/** The slice of `fetch` the checker needs — the global one, or a stand-in. */
export type Fetcher = (
  url: string,
  init: { method: "GET"; redirect: "follow"; signal: AbortSignal },
) => Promise<{
  status: number;
  headers: { get(name: string): string | null };
}>;

const TIMEOUT_MS = 15_000;

type KnownWarning = "cloudflare-403" | "incomplete-chain";

/**
 * The portals allowed to answer short of 200, and how. Adding an entry is a
 * decision that the portal still serves readers — check it in a browser
 * first — and removing one is what to do when it starts answering 200.
 */
export const KNOWN_WARNINGS: Partial<
  Record<RoutingEntry["category"], KnownWarning>
> = {
  migracion: "cloudflare-403",
  meic: "incomplete-chain",
  // ccpa.or.cr serves its leaf and the Sectigo root with no intermediate
  // between them (openssl: "unable to verify the first certificate",
  // 2026-09-10). Browsers and curl fetch the issuer themselves and load the
  // page; Node's fetch does not. Same misconfiguration as meic.
  contadores: "incomplete-chain",
};

/**
 * OpenSSL's codes for "the chain stops before a root I trust" — an
 * intermediate the server forgot to send. Anything else on the TLS side
 * (expired, wrong host, self-signed) is a real failure and stays one.
 */
const INCOMPLETE_CHAIN_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
]);

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const cause = (error as { cause?: unknown }).cause;
    if (typeof cause === "object" && cause !== null && "code" in cause) {
      return String((cause as { code: unknown }).code);
    }
    if ("code" in error) return String((error as { code: unknown }).code);
    if (error instanceof Error) return error.name;
  }
  return "unknown";
}

async function verdictFor(
  entry: RoutingEntry,
  fetcher: Fetcher,
): Promise<UrlVerdict> {
  const base = { category: entry.category, url: entry.url };
  try {
    const response = await fetcher(entry.url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (response.status === 200) {
      return { ...base, outcome: "ok", detail: "200" };
    }
    const server = response.headers.get("server")?.toLowerCase() ?? "";
    if (response.status === 403 && server.includes("cloudflare")) {
      const detail =
        "403 from Cloudflare — the WAF refuses non-browser clients";
      return KNOWN_WARNINGS[entry.category] === "cloudflare-403"
        ? { ...base, outcome: "warning", detail }
        : {
            ...base,
            outcome: "failure",
            detail: `${detail} (not expected here)`,
          };
    }
    return { ...base, outcome: "failure", detail: String(response.status) };
  } catch (error) {
    const code = errorCode(error);
    if (INCOMPLETE_CHAIN_CODES.has(code)) {
      const detail = `${code} — the server sends an incomplete certificate chain`;
      return KNOWN_WARNINGS[entry.category] === "incomplete-chain"
        ? { ...base, outcome: "warning", detail }
        : {
            ...base,
            outcome: "failure",
            detail: `${detail} (not expected here)`,
          };
    }
    return { ...base, outcome: "failure", detail: code };
  }
}

export async function checkRoutingUrls(
  fetcher: Fetcher = fetch,
  entries: readonly RoutingEntry[] = ROUTING,
): Promise<UrlReport> {
  const verdicts = await Promise.all(
    entries.map((entry) => verdictFor(entry, fetcher)),
  );
  return {
    verdicts,
    warnings: verdicts.filter((v) => v.outcome === "warning"),
    failures: verdicts.filter((v) => v.outcome === "failure"),
  };
}

const LABEL: Record<UrlOutcome, string> = {
  ok: "ok  ",
  warning: "WARN",
  failure: "FAIL",
};

export function formatReport(report: UrlReport): string {
  return report.verdicts
    .map(
      (v) =>
        `${LABEL[v.outcome]} ${v.category.padEnd(18)} ${v.url}` +
        (v.outcome === "ok" ? "" : ` → ${v.detail}`),
    )
    .join("\n");
}

async function main(): Promise<void> {
  const report = await checkRoutingUrls();
  console.log(formatReport(report));
  if (report.warnings.length > 0) {
    console.warn(
      `\n${report.warnings.length} routing URL(s) answered, but not to this client — ` +
        "open each in a browser before trusting the warning.",
    );
  }
  if (report.failures.length > 0) {
    console.error(
      `\n${report.failures.length} routing URL(s) did not answer — ` +
        "update src/lib/routing.ts before the next decline sends a reader there.",
    );
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith("check-routing-urls.ts")) {
  void main();
}
