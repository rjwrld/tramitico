import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/utils";

/**
 * Hosts the post-login redirect may land on: the request's own host plus the
 * canonical site host when `NEXT_PUBLIC_SITE_URL` is configured. An
 * `x-forwarded-host` outside this set falls back to same-origin — the trust
 * decision is recorded in docs/audits/post-mvp-readiness-audit.md §12 (#210).
 */
function isAllowedHost(host: string, origin: string): boolean {
  if (host === new URL(origin).host) return true;
  const site = process.env.NEXT_PUBLIC_SITE_URL;
  if (!site) return false;
  try {
    return host === new URL(site).host;
  } catch {
    return false;
  }
}

// OAuth (GitHub) landing: exchanges the ?code for a session cookie.
export async function GET(request: Request) {
  const { origin, searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const safeNext = safeNextPath(searchParams.get("next"));

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const forwardedHost = request.headers.get("x-forwarded-host");
      const isLocal = process.env.NODE_ENV === "development";
      if (!isLocal && forwardedHost && isAllowedHost(forwardedHost, origin)) {
        return NextResponse.redirect(`https://${forwardedHost}${safeNext}`);
      }
      return NextResponse.redirect(`${origin}${safeNext}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth/error`);
}
