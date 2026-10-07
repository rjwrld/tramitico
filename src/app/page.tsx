import type { Metadata } from "next";

import { Chat } from "@/components/chat/chat";
import { HistoryShell } from "@/components/history/history-shell";
import { SiteHeader } from "@/components/site-header";
import {
  CORPUS_DOCUMENT_COUNT,
  corpusCount,
  corpusSample,
} from "@/lib/corpus-summary";
import { createClient } from "@/lib/supabase/server";

/** Title and description come from the root layout; only the canonical is ours. */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

export default async function Home() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; email?: string } | undefined;
  const signedIn = Boolean(claims?.sub);

  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader signedIn={signedIn} email={claims?.email} />
      <HistoryShell signedIn={signedIn}>
        <main className="flex min-h-0 flex-1 flex-col">
          <Chat
            corpusCount={corpusCount(CORPUS_DOCUMENT_COUNT)}
            corpusSample={corpusSample()}
          />
        </main>
      </HistoryShell>
    </div>
  );
}
