import Link from "next/link";

import { UserMenu } from "@/components/auth/user-menu";
import { HistoryShell } from "@/components/history/history-shell";
import { buttonVariants } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; email?: string } | undefined;
  const signedIn = Boolean(claims?.sub);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-12 items-center justify-between border-b px-4">
        <Link href="/" className="font-serif text-lg font-semibold">
          trami<span className="text-primary">tico</span>
        </Link>
        {signedIn ? (
          <UserMenu email={claims?.email ?? ""} />
        ) : (
          <Link
            href="/login"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            Iniciar sesión
          </Link>
        )}
      </header>
      <HistoryShell signedIn={signedIn}>
        <main className="flex flex-1 flex-col items-center justify-center gap-6 p-8">
          <h1 className="font-serif text-4xl font-semibold tracking-tight">
            trami<span className="text-primary">tico</span>
          </h1>
          <p className="max-w-md text-center text-muted-foreground">
            Respuestas sobre impuestos y trámites para desarrolladores
            independientes en Costa Rica — con cita al artículo oficial.
          </p>
          <span className="rounded-sm border border-sello-border bg-sello-bg px-2 py-1 font-mono text-[11px] font-medium tracking-wider text-sello uppercase shadow-[inset_0_0_0_3px_var(--sello-bg),inset_0_0_0_4px_var(--sello-border)]">
            Próximamente · Art. 1
          </span>
        </main>
      </HistoryShell>
    </div>
  );
}
