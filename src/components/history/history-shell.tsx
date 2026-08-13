"use client";

// Signed-in layout: history sidebar + main column. Signed-out renders only the
// children — the sidebar never mounts and /api/history is never called.
// Deletes go through DELETE /api/history/:id: since the least-privilege
// lockdown (issue #123) the browser client has no privileges on the table, so
// the server does the delete under the service role, scoped to the session.

import { PanelLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

import { HistorySidebar, type HistoryItem } from "./history-sidebar";
import { QAView } from "./qa-view";

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

  useEffect(() => {
    if (!signedIn) return;
    let cancelled = false;
    fetch("/api/history")
      .then(async (response) => {
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { questions: HistoryItem[] };
        if (!cancelled) setItems(body.questions);
      })
      .catch(() => {
        if (!cancelled)
          toast.error("No se pudo cargar el historial. Intente de nuevo.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [signedIn]);

  if (!signedIn) {
    return <>{children}</>;
  }

  async function handleDelete(id: string) {
    const previous = items;
    setItems(items.filter((item) => item.id !== id));
    if (selected?.id === id) setSelected(null);
    try {
      const response = await fetch(`/api/history/${id}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
    } catch {
      setItems(previous);
      toast.error("No se pudo eliminar la pregunta. Intente de nuevo.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1">
      {/* DESIGN §7: the sidebar collapses first — hidden on small screens,
          unmounted (not css-hidden) when toggled closed. */}
      {!collapsed && (
        <aside className="hidden w-64 shrink-0 border-r md:flex md:flex-col">
          <HistorySidebar
            items={items}
            loading={loading}
            selectedId={selected?.id}
            onSelect={setSelected}
            onDelete={(id) => void handleDelete(id)}
          />
        </aside>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="hidden px-2 pt-2 md:block">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={collapsed ? "Mostrar historial" : "Ocultar historial"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          >
            <PanelLeft />
          </Button>
        </div>
        {selected ? (
          <QAView item={selected} onBack={() => setSelected(null)} />
        ) : (
          children
        )}
      </div>
    </div>
  );
}
