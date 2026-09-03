import Link from "next/link";

import { UserMenu } from "@/components/auth/user-menu";
import { Chat } from "@/components/chat/chat";
import { HistoryShell } from "@/components/history/history-shell";
import { ThemeToggle } from "@/components/theme-toggle";
import { buttonVariants } from "@/components/ui/button";
import { CORPUS_DOCUMENT_COUNT, corpusCaption } from "@/lib/corpus-summary";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; email?: string } | undefined;
  const signedIn = Boolean(claims?.sub);

  return (
    <div className="flex h-dvh flex-col">
      {/* `px-safe` (#138): landscape on a notched phone puts the cutout
          beside the header, so its inline padding takes whichever is larger —
          the design's 16px or the device's inset. */}
      <header className="flex h-12 items-center justify-between border-b px-safe">
        <Link href="/" className="font-serif text-lg font-semibold">
          trami<span className="text-primary">tico</span>
        </Link>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          {signedIn ? (
            <UserMenu email={claims?.email ?? ""} />
          ) : (
            <Link
              href="/login"
              className={buttonVariants({
                variant: "outline",
                size: "sm",
                className: "pointer-coarse:h-11",
              })}
            >
              Iniciar sesión
            </Link>
          )}
        </div>
      </header>
      <HistoryShell signedIn={signedIn}>
        <main className="flex min-h-0 flex-1 flex-col">
          <Chat corpusCaption={corpusCaption(CORPUS_DOCUMENT_COUNT)} />
        </main>
      </HistoryShell>
    </div>
  );
}
