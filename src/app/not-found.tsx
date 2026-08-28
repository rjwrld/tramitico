import type { Metadata } from "next";
import Link from "next/link";

/**
 * The 404 (issue #215). `not-found.tsx` at the app root catches both an
 * explicit `notFound()` and every unmatched URL, and — unlike the
 * experimental `global-not-found.tsx` — it renders *inside* the root layout,
 * so it inherits the fonts, the tokens and the `.dark` class the
 * ThemeProvider puts on <html>. Next's own default does none of that: it is
 * English, unbranded, and reads `prefers-color-scheme` rather than the app's
 * theme.
 */
export const metadata: Metadata = {
  title: "Página no encontrada — Tramitico",
};

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[36rem] flex-col items-center justify-center gap-4 px-6 text-center">
      <Link href="/" className="font-serif text-2xl font-semibold">
        trami<span className="text-primary">tico</span>
      </Link>
      {/* Mono, like every other piece of data in the app (DESIGN §3). */}
      <p className="font-mono text-[0.6875rem] font-medium tracking-[0.03em] text-muted-foreground uppercase">
        Error 404
      </p>
      <h1 className="font-serif text-[2rem] font-semibold tracking-display text-balance">
        Esta página no existe
      </h1>
      <p className="text-muted-foreground text-sm text-balance">
        Puede que el enlace esté mal escrito o que la página se haya movido.
        Vuelva al inicio y haga su consulta desde ahí.
      </p>
      <Link href="/" className="text-sm underline underline-offset-4">
        Volver al inicio
      </Link>
    </main>
  );
}
