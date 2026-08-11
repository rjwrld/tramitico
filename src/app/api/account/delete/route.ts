import { NextResponse } from "next/server";

import { sessionUserId } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

// POST /api/account/delete — auth required (SPEC §7, issue #86). Verifies the
// session server-side via the same cookie-scoped `getClaims` path as
// /api/history, then deletes the auth user with the service-role client —
// deleting the auth user is admin-only, so it cannot happen from the browser
// client. `questions.user_id` has ON DELETE CASCADE (core_schema.sql), so
// history disappears atomically with the account. No request body: the
// session is the sole authorization, never a caller-supplied id.
export async function POST() {
  const supabase = await createClient();

  const userId = await sessionUserId(supabase);
  if (!userId) {
    return NextResponse.json(
      { error: "Inicie sesión para eliminar su cuenta." },
      { status: 401 },
    );
  }

  const { error } = await serviceClient().auth.admin.deleteUser(userId);
  if (error) {
    return NextResponse.json(
      { error: "No se pudo eliminar la cuenta. Intente de nuevo." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
