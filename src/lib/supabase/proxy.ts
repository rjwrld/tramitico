import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

import type { Database } from "@/lib/database.types";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Validates the JWT and refreshes an expired session; the setAll above
  // writes the refreshed cookies onto the response. No redirect on signed-out:
  // every MVP surface works anonymously (SPEC §7).
  //
  // `getClaims()` reports most failures as `{ error }`, but a cookie whose JWT
  // header names an algorithm it cannot verify makes it *throw* a plain Error
  // instead. A visitor who presents such a cookie is signed out, not a 500 —
  // the same degrade-to-anonymous `cookieUserId` applies on /api/ask.
  try {
    await supabase.auth.getClaims();
  } catch {
    // Treated as no session; the response carries whatever cookies were set.
  }

  return supabaseResponse;
}
