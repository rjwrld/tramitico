import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

// POST /api/account/delete — auth required (SPEC §7, issues #86 and #124).
//
// Unlike the read paths (/api/history, the home page), this route verifies the
// caller with `getUser()` — a round trip to the Auth server — not `getClaims()`.
// Under asymmetric signing keys `getClaims()` verifies the JWT locally, so it
// keeps accepting an access token whose user was already deleted until the
// token expires (≤1h); `getUser()` rejects it immediately ("User from sub
// claim in JWT does not exist"). Deletion is an auth-tier action, so it pays
// the round trip; the read paths' ≤1h tail is the accepted risk on #121.
//
// Then, in this order: global sign-out, delete. The admin sign-out needs a JWT
// whose user still exists, so it cannot run after `deleteUser` — GoTrue
// rejects it. Global scope kills every refresh token of the account, not just
// the initiating browser's.
//
// Deleting the auth user is admin-only, so it cannot happen from the browser
// client. `questions.user_id` has ON DELETE CASCADE (core_schema.sql), so
// history disappears atomically with the account. No request body: the session
// is the sole authorization, never a caller-supplied id.
export async function POST() {
  const supabase = await createClient();

  const { data: userData, error: userError } = await supabase.auth.getUser();
  const userId = userError ? null : userData.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Inicie sesión para eliminar su cuenta." },
      { status: 401 },
    );
  }

  const admin = serviceClient();

  // The cookie's access token, needed to name the session being revoked. It is
  // safe to read unverified here: `getUser()` above already established the
  // identity, and a token GoTrue rejects just makes the sign-out a no-op.
  const { data: sessionData } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (accessToken) {
    const { error } = await admin.auth.admin.signOut(accessToken, "global");
    // Never block the deletion on this: the user asked for the account to go,
    // and deleting the auth user cascades its sessions anyway.
    if (error) {
      console.error(`account delete: global sign-out failed: ${error.message}`);
    }
  }

  const { error } = await admin.auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json(
      { error: "No se pudo eliminar la cuenta. Intente de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
