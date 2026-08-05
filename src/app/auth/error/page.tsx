import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Error de sesión — Tramitico",
};

export default function AuthErrorPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[44rem] flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-lg font-semibold">No se pudo iniciar sesión</h1>
      <p className="text-muted-foreground text-sm">
        El enlace expiró o ya fue usado. Vuelva al inicio e intente de nuevo.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Volver al inicio
      </Link>
    </main>
  );
}
