import { describeError } from "@/lib/log-redaction";
import { tryServiceClient } from "@/lib/supabase/service";

/**
 * GET /api/health — the endpoint an external uptime monitor polls (#553).
 *
 * Production is one Supabase free project, which pauses after 7 days without
 * activity; `keepalive.yml` is the in-repo answer, and GitHub disables it with
 * every other scheduled workflow after 60 days without a commit. A monitor
 * outside GitHub calling this every few minutes keeps the project awake
 * through a quiet repo, and alerts when the site stops answering (runbook §7).
 *
 * So the check is the same one `keepalive.yml` makes: one row from
 * `documents` through the service-role client — the #123 lockdown leaves no
 * cheaper credential that can read a row. Nothing else: no question, no
 * session, no provider call, nothing a caller sends is read. The body is a
 * fixed word either way, so the monitor learns up or down and nothing more.
 *
 * An empty `documents` is still 200: the database answered, which is what a
 * keep-alive and an uptime signal need. A missing corpus is the canary's
 * finding (#551), not this endpoint's.
 */

// The read is the point, so it happens per request: never prerendered at build
// time. Segment config, not `connection()`: this app does not enable Cache
// Components, and `connection()` throws outside a request scope (unit tests).
export const dynamic = "force-dynamic";

/** Past this, the read counts as down — well inside a monitor's own timeout. */
const READ_TIMEOUT_MS = 5_000;

/** A monitor polls; a cache that answered for it would hide the outage. */
const HEADERS = { "Cache-Control": "no-store" };

function unavailable(reason: string): Response {
  // The prefix is constant and the variables are `key=value`, like the other
  // operational lines; `reason` is ours, and the error goes through the one
  // log-safe path even though no question can be on it.
  console.error(`[health] unavailable — ${reason}`);
  return Response.json(
    { status: "unavailable" },
    { status: 503, headers: HEADERS },
  );
}

export async function GET() {
  const client = tryServiceClient();
  if (!client) return unavailable("reason=config");

  try {
    const { error } = await client
      .from("documents")
      .select("id")
      .limit(1)
      .abortSignal(AbortSignal.timeout(READ_TIMEOUT_MS));
    if (error) return unavailable(`error=${describeError(error)}`);
  } catch (error) {
    return unavailable(`error=${describeError(error)}`);
  }

  return Response.json({ status: "ok" }, { headers: HEADERS });
}
