import { type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Everything except static assets and the session-free public surface —
  // API routes included, so route handlers always see a refreshed session.
  //
  // The session-free public surface is `/acerca` (ISR, `revalidate = 3600`),
  // `/privacidad` and `/terminos` (fully static), `/sitemap.xml` and
  // `/robots.txt`. Each is the same bytes for every visitor and never reads
  // the session — the two legal pages import only prose constants and the
  // rate limiter's quota numbers, no cookies, headers or Supabase client (#385)
  // — so the refresh has nothing to do there. Excluding them also keeps the
  // refresh's `Set-Cookie` off responses the framework marks CDN-cacheable
  // (`s-maxage`): a cache that stored one is a cache that would replay it.
  // A page added to this list must stay session-free; `src/proxy.test.ts`
  // pins the paths, and the exclusions are anchored so `/privacidad/x` is
  // still routed.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|acerca$|privacidad$|terminos$|sitemap\\.xml$|robots\\.txt$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
