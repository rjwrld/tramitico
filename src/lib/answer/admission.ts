/**
 * What `/api/ask` checks about a request before it reads the body, and about
 * the question before it charges the quota.
 *
 * The anonymous quota is keyed on the caller's IP and browser family
 * (`rate-limit.ts`), and both come with every request a browser sends,
 * including one another site's page makes it send. A `text/plain` form post
 * or a `no-cors` fetch skips the CORS preflight, carries no session cookie
 * (SameSite=Lax), and would otherwise run the whole paid pipeline against the
 * visitor's allowance. Next's own Origin check covers Server Actions only, not
 * route handlers, so the route draws the line itself: JSON only, which makes
 * any cross-origin browser call preflighted (and this route answers no
 * preflight), and a same-origin `Sec-Fetch-Site` / `Origin` whenever the
 * browser sends them. A non-browser client sends neither header and can only
 * spend its own IP's quota, so it stays allowed.
 */

/**
 * True when the request must not reach the body parse: not JSON, or a
 * browser request from another origin. The Origin comparison mirrors Next's
 * Server Action check — the Origin's host against `x-forwarded-host`, else
 * `host` — so it holds on Vercel previews and behind the platform proxy
 * without a list of allowed origins.
 */
export function isCrossSiteAsk(request: Request): boolean {
  const type = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return true;

  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin") return true;

  const origin = request.headers.get("origin");
  if (origin === null) return false;
  const host =
    request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
    request.headers.get("host");
  if (!host) return true;
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

/**
 * True when the question holds text Postgres cannot store: U+0000, or an
 * unpaired surrogate. Either one passes the length check, is charged, runs
 * the paid expansion and embeds, and then fails the `search_chunks` call as a
 * refunded `retrieval_failed` — paid work the quota never keeps. Rejecting it
 * before the quota makes it an ordinary 400.
 */
export function hasUnstorableText(text: string): boolean {
  return text.includes("\u0000") || !text.isWellFormed();
}
