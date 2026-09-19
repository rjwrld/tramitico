import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Everything except static assets and the session-free public surface —
  // API routes included, so route handlers always see a refreshed session.
  //
  // `/acerca` (ISR, `revalidate = 3600`), `/sitemap.xml` and `/robots.txt`
  // are the same bytes for every visitor and never read the session, so the
  // refresh has nothing to do there. Excluding them also keeps the refresh's
  // `Set-Cookie` off responses the framework marks CDN-cacheable
  // (`s-maxage`): a cache that stored one is a cache that would replay it.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|acerca$|sitemap\\.xml$|robots\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
