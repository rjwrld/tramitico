import { NextResponse } from "next/server";

import { listQuestions, sessionUserId } from "@/lib/history";
import { createClient } from "@/lib/supabase/server";

// GET /api/history — auth required (SPEC §6). The client is cookie-scoped, so
// RLS already limits the select to the session's own rows.
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
    const questions = await listQuestions(supabase);
    return NextResponse.json({ questions });
  } catch {
    return NextResponse.json(
      { error: "No se pudo cargar el historial. Intente de nuevo." },
      { status: 500 },
    );
  }
}
