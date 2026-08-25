"use client";

// Signed-in layout: history sidebar + main column. Signed-out renders only the
// children — the sidebar never mounts and /api/history is never called.
// Deletes go through DELETE /api/history/:id: since the least-privilege
// lockdown (issue #123) the browser client has no privileges on the table, so
// the server does the delete under the service role, scoped to the session.
//
// Below `md` the sidebar has no room, so the same list opens as a sheet over
// the ground (issue #138) — one `HistorySidebar`, two homes.

import { PanelLeft } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { HistoryRefreshProvider } from "./history-refresh";
import { HistorySidebar, type HistoryItem } from "./history-sidebar";
import { QAView } from "./qa-view";

/**
 * The refresh a finished answer triggers is a race: `/api/ask` writes its row
 * from the model stream's `onFinish`, which is not ordered against the last
 * byte the browser reads (the weak-retrieval path writes its `finish` part
 * before saving at all). So a refetch that comes back with the same newest row
 * is treated as "too early" and tried again, rather than leaving the answer
 * missing from the list until the next reload.
 */
const REFRESH_ATTEMPTS = 3;
const REFRESH_RETRY_MS = 1000;

const HISTORY_LOAD_ERROR = "No se pudo cargar el historial. Intente de nuevo.";

async function fetchHistory(): Promise<HistoryItem[]> {
  const response = await fetch("/api/history");
  if (!response.ok) throw new Error(String(response.status));
  const body = (await response.json()) as { questions: HistoryItem[] };
  return body.questions;
}

const wait = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function HistoryShell({
  signedIn,
  children,
}: {
  signedIn: boolean;
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<HistoryItem | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Read by `refresh`, which must compare against whatever the list holds at
  // the moment it runs — not the render it was created in.
  const newestIdRef = useRef<string | null>(null);

  const apply = useCallback((questions: HistoryItem[]) => {
    newestIdRef.current = questions[0]?.id ?? null;
    setItems(questions);
  }, []);

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetchHistory()
      .then((questions) => {
        if (!cancelled) apply(questions);
      })
      .catch(() => {
        if (!cancelled) toast.error(HISTORY_LOAD_ERROR);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn, apply]);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    const before = newestIdRef.current;
    void (async () => {
      for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt++) {
        try {
          const questions = await fetchHistory();
          apply(questions);
          if ((questions[0]?.id ?? null) !== before) return;
        } catch {
          // Silent on purpose: nothing the reader asked for failed — they have
          // their answer, and the list is one reload away from correct.
        }
        if (attempt < REFRESH_ATTEMPTS - 1) await wait(REFRESH_RETRY_MS);
      }
    })();
  }, [signedIn, apply]);

  const handleDelete = useCallback(
    async (id: string) => {
      const previous = items;
      apply(items.filter((item) => item.id !== id));
      if (selected?.id === id) setSelected(null);
      try {
        const response = await fetch(`/api/history/${id}`, {
          method: "DELETE",
        });
        if (!response.ok) throw new Error(String(response.status));
      } catch {
        apply(previous);
        toast.error("No se pudo eliminar la pregunta. Intente de nuevo.");
      }
    },
    [items, selected, apply],
  );

  if (!signedIn) {
    return <>{children}</>;
  }

  const sidebar = (onSelected?: () => void) => (
    <HistorySidebar
      items={items}
      loading={loading}
      selectedId={selected?.id}
      onSelect={(item) => {
        setSelected(item);
        onSelected?.();
      }}
      onDelete={(id) => void handleDelete(id)}
    />
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* DESIGN §7: the sidebar collapses first — hidden on small screens,
          unmounted (not css-hidden) when toggled closed. */}
      {!collapsed && (
        <aside className="hidden w-64 shrink-0 border-r md:flex md:flex-col">
          {sidebar()}
        </aside>
      )}
      {/* The ground owns its scroll (issue #172). Without `min-h-0` this
          column grew to its content instead, spilling out of the `h-dvh`
          shell and making the *document* the scroller — which took the
          history trigger below the fold with it. Reaching the trigger then
          meant scrolling back to the top, so opening the sheet over a
          scrolled answer lost the reader's place and closing it never gave
          that place back. With the scroll one level in, the toolbar stays
          put, the trigger is always reachable, and the offset the reader is
          at is simply never touched. */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="px-2 pt-2">
          {/* Two controls, one at a time — `display: none` keeps the hidden
              one out of the accessibility tree too. They are named for what
              they do rather than sharing a label: the sheet opens and closes,
              the sidebar shows and hides. */}
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Abrir historial"
                  className="md:hidden"
                />
              }
            >
              <PanelLeft />
            </SheetTrigger>
            {/* Named apart from the `nav aria-label="Historial"` it wraps, so
                the dialog and the landmark inside it are two distinct
                announcements rather than the same word twice. */}
            <SheetContent
              aria-label="Historial de preguntas"
              closeLabel="Cerrar historial"
            >
              {sidebar(() => setSheetOpen(false))}
            </SheetContent>
          </Sheet>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? "Mostrar historial" : "Ocultar historial"}
            aria-expanded={!collapsed}
            className="hidden md:inline-flex"
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft />
          </Button>
        </div>
        {/* One scroller for whatever the ground shows. A restored answer
            overflows it and scrolls here; the chat view brings its own
            `MessageScroller`, which resolves to exactly this height and so
            leaves this one with nothing to scroll. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          <HistoryRefreshProvider value={refresh}>
            {selected ? (
              <QAView item={selected} onBack={() => setSelected(null)} />
            ) : (
              children
            )}
          </HistoryRefreshProvider>
        </div>
      </div>
    </div>
  );
}
