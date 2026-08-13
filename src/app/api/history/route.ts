import { NextResponse } from "next/server";

import { asHistoryClient, listQuestions, sessionUserId } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";
import { serviceClient } from "@/lib/supabase/service";

// GET /api/history — auth required (SPEC §6). Two clients on purpose: the
// cookie-scoped one proves who is asking, the service-role one does the read,
// because the least-privilege lockdown (issue #123) leaves `authenticated`
// with no privileges on `public`. The select is scoped by the session's own
// id, which the caller cannot influence.
export async function GET() {
  const supabase = await createClient();

  const userId = await sessionUserId(supabase);
  if (!userId) {
    return NextResponse.json(
      { error: "Inicie sesión para ver su historial." },
      { status: 401 },
    );
  }

  try {
    const questions = await listQuestions(
      asHistoryClient(serviceClient()),
      userId,
    );
    return NextResponse.json({ questions });
  } catch {
    return NextResponse.json(
      { error: "No se pudo cargar el historial. Intente de nuevo." },
      { status: 500 },
    );
  }
}
