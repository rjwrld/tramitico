import { NextResponse } from "next/server";

import { asHistoryClient, deleteQuestion, sessionUserId } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

// DELETE /api/history/:id — auth required (SPEC §7). The browser used to
// delete straight from its own Supabase client and let RLS scope the row; the
// least-privilege lockdown (issue #123) took that privilege away, so the
// delete moved here. The id in the path is the caller's, the user id is the
// session's, and the query requires both to match — passing someone else's id
// deletes nothing.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();

  const userId = await sessionUserId(supabase);
  if (!userId) {
    return NextResponse.json(
      { error: "Inicie sesión para eliminar preguntas." },
      { status: 401 },
    );
  }

  const { id } = await params;

  try {
    await deleteQuestion(asHistoryClient(serviceClient()), id, userId);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "No se pudo eliminar la pregunta. Intente de nuevo." },
      { status: 500 },
    );
  }
}
