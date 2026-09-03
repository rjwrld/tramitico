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
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";

import { HistoryRefreshProvider } from "./history-refresh";
import { HistorySidebar, type HistoryItem } from "./history-sidebar";
import { QAView } from "./qa-view";

/**
 * The refresh a finished answer triggers used to be a race: `/api/ask` wrote
 * its row without ordering it against the last byte the browser reads, so a
 * refetch could arrive before the insert. Since #139 the route holds its
 * `finish` part until the save has resolved — that part is what carries the
 * "not saved" marker, so it has to — which puts the row ahead of the refetch
 * on every path. The retry stays anyway: it is cheap, and it still covers a
 * read that lands behind the write on the database's side.
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

/**
 * Put a row back where the server would have it — newest first, by
 * `created_at` — rather than at the head. A failed delete has to leave the
 * list exactly as it found it, including for rows that arrived while the
 * request was in flight.
 */
function restore(current: HistoryItem[], item: HistoryItem): HistoryItem[] {
  if (current.some((existing) => existing.id === item.id)) return current;
  const at = current.findIndex(
    (existing) => existing.created_at < item.created_at,
  );
  const next = [...current];
  next.splice(at === -1 ? current.length : at, 0, item);
  return next;
}

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
  // The desktop sidebar and its toggle (DESIGN §8, panel transitions): the
  // fold is a width + opacity transition, so the aside stays mounted while
  // closed — `inert` keeps it out of the tab order and the accessibility
  // tree, which is what unmounting used to buy. Folding with focus still
  // inside it (Safari does not move focus to a clicked button) would let
  // `inert` drop focus to `<body>`, so the toggle takes it first.
  const asideRef = useRef<HTMLElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const toggleSidebar = () => {
    if (!collapsed && asideRef.current?.contains(document.activeElement)) {
      toggleRef.current?.focus();
    }
    setCollapsed(!collapsed);
  };
  // Read by `refresh`, which must compare against whatever the list holds at
  // the moment it runs — not the render it was created in.
  const newestIdRef = useRef<string | null>(null);
  // Rows the UI has removed but the server has not confirmed gone (issue
  // #213). Every server list is filtered through these before it reaches the
  // screen, because a GET that overlapped the delete reads the *pre*-delete
  // state and would put the row back.
  //
  // A tombstone outlives its own DELETE: dropping it the moment the delete
  // succeeds still loses to a GET that was already in flight when the delete
  // started. So each tombstone records the read counter at the moment it
  // settled, and only a read begun *after* that — one that cannot be carrying
  // pre-delete state — is authoritative enough to clear it.
  const tombstonesRef = useRef(new Map<string, number | null>());
  // Reads of `/api/history`, counted in the order they are sent.
  const readSeqRef = useRef(0);
  // `handleDelete` reads the list and the selection at the moment it runs,
  // and must not be re-created per render: two deletes racing each other have
  // to share one set of tombstones, not one per closure.
  const itemsRef = useRef<HistoryItem[]>([]);
  const selectedRef = useRef<HistoryItem | null>(null);
  useEffect(() => {
    itemsRef.current = items;
    selectedRef.current = selected;
    // A delete and its rollback move the list without going through `apply`,
    // so the newest id is tracked from the list itself rather than only from
    // the last server response.
    newestIdRef.current = items[0]?.id ?? null;
  }, [items, selected]);

  // One read of the list, tagged with its place in the read order so `apply`
  // can tell a response that predates a delete from one that follows it.
  const readHistory = useCallback(async () => {
    const seq = ++readSeqRef.current;
    return { seq, questions: await fetchHistory() };
  }, []);

  const apply = useCallback(
    ({ seq, questions }: { seq: number; questions: HistoryItem[] }) => {
      for (const [id, settledAt] of tombstonesRef.current) {
        if (settledAt !== null && settledAt < seq)
          tombstonesRef.current.delete(id);
      }
      const visible = questions.filter(
        (question) => !tombstonesRef.current.has(question.id),
      );
      newestIdRef.current = visible[0]?.id ?? null;
      setItems(visible);
      return visible;
    },
    [],
  );

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    readHistory()
      .then((read) => {
        if (!cancelled) apply(read);
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
  }, [signedIn, apply, readHistory]);

  const refresh = useCallback(() => {
    if (!signedIn) return;
    const before = newestIdRef.current;
    void (async () => {
      for (let attempt = 0; attempt < REFRESH_ATTEMPTS; attempt++) {
        try {
          const visible = apply(await readHistory());
          if ((visible[0]?.id ?? null) !== before) return;
        } catch {
          // Silent on purpose: nothing the reader asked for failed — they have
          // their answer, and the list is one reload away from correct.
        }
        if (attempt < REFRESH_ATTEMPTS - 1) await wait(REFRESH_RETRY_MS);
      }
    })();
  }, [signedIn, apply, readHistory]);

  const handleDelete = useCallback(async (id: string) => {
    // A second confirm for a row already being deleted must not send a second
    // DELETE: the first one wins on the server, and the loser's 404 would
    // roll a genuinely deleted row back onto the screen. `itemsRef` cannot
    // catch this on its own — it is only current as of the last commit.
    if (tombstonesRef.current.has(id)) return;
    const removed = itemsRef.current.find((item) => item.id === id);
    if (!removed) return;
    tombstonesRef.current.set(id, null);
    setItems((current) => current.filter((item) => item.id !== id));
    if (selectedRef.current?.id === id) setSelected(null);
    try {
      const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      // Gone for good — but keep the tombstone until a read begun from here
      // on confirms it, so a GET still in flight cannot resurrect the row.
      tombstonesRef.current.set(id, readSeqRef.current);
    } catch {
      // Per-item rollback, against whatever the list holds *now* (#213). The
      // old code restored a snapshot taken before the request, which undid
      // every delete and refresh that had landed in the meantime.
      tombstonesRef.current.delete(id);
      setItems((current) => restore(current, removed));
      toast.error("No se pudo eliminar la pregunta. Intente de nuevo.");
    }
  }, []);

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
          folded to zero width (inert, not unmounted) when toggled closed. The
          inner column keeps its 16rem so the list never re-wraps mid-fold;
          the border rides on it so nothing is left behind at width 0. */}
      <aside
        ref={asideRef}
        inert={collapsed}
        aria-hidden={collapsed}
        className={cn(
          "hidden shrink-0 overflow-hidden md:flex",
          "transition-[width,opacity] duration-200 ease-out-quart motion-reduce:transition-opacity",
          collapsed ? "w-0 opacity-0" : "w-64 opacity-100",
        )}
      >
        <div className="flex w-64 shrink-0 flex-col border-r">{sidebar()}</div>
      </aside>
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
            ref={toggleRef}
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? "Mostrar historial" : "Ocultar historial"}
            aria-expanded={!collapsed}
            className="hidden md:inline-flex"
            onClick={toggleSidebar}
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
