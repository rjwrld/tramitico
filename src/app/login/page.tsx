import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SignInForm } from "@/components/auth/sign-in-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { sessionUserId } from "@/lib/history";
import { signedInLimitGain } from "@/lib/rate-limit";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  // A sign-in form is not a search result. robots.txt leaves it crawlable on
  // purpose, so a crawler can read this.
  robots: { index: false, follow: true },
};

/**
 * Why to sign in, in one line. The saved history always; more questions only
 * when the signed-in quota is actually larger (#501).
 */
function signInPitch(): string {
  const gain = signedInLimitGain();
  return gain === null
    ? "Guarde su historial de preguntas."
    : `Guarde su historial de preguntas y consulte hasta ${gain} por día.`;
}

export default async function LoginPage() {
  const supabase = await createClient();
  if (await sessionUserId(supabase)) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 px-6">
      <Link
        href="/"
        className="inline-flex items-center rounded-xs font-serif text-2xl font-semibold pointer-coarse:min-h-11"
      >
        trami<span className="text-primary">tico</span>
      </Link>
      <Card className="w-full">
        <CardHeader>
          {/* The page's one heading (#492): the card title rendered a bare
              `div`, which left /login with no heading at all. */}
          <CardTitle as="h1">Iniciar sesión</CardTitle>
          <CardDescription>{signInPitch()}</CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
