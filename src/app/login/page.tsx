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
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  // A sign-in form is not a search result; robots.txt disallows it too.
  robots: { index: false, follow: true },
};

export default async function LoginPage() {
  const supabase = await createClient();
  if (await sessionUserId(supabase)) {
    redirect("/");
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col items-center justify-center gap-6 px-6">
      <Link href="/" className="font-serif text-2xl font-semibold">
        trami<span className="text-primary">tico</span>
      </Link>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Iniciar sesión</CardTitle>
          <CardDescription>
            Guarde su historial de preguntas y consulte hasta 50 por día.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SignInForm />
        </CardContent>
      </Card>
    </main>
  );
}
