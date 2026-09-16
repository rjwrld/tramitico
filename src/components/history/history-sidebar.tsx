// Client component via its importers (history-shell).
// Presentational history list (issue #23). Pure — data and mutations come in
// as props, so states are unit-testable. Delete follows red discipline
// (DESIGN §5): a confirm step with destructive-styled text, never the brand
// red fill.

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmInline } from "@/components/ui/confirm-inline";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export interface HistoryItem {
  id: string;
  question: string;
  answer: string;
  citations: unknown;
  created_at: string;
}

interface HistorySidebarProps {
  items: HistoryItem[];
  loading?: boolean;
  selectedId?: string | null;
  onSelect: (item: HistoryItem) => void;
  onDelete: (id: string) => void;
}

const dateFormat = new Intl.DateTimeFormat("es-CR", {
  day: "numeric",
  month: "short",
});

export function HistorySidebar({
  items,
  loading = false,
  selectedId = null,
  onSelect,
  onDelete,
}: HistorySidebarProps) {
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  return (
    <nav aria-label="Historial" className="flex h-full flex-col gap-2 p-3">
      <h2 className="px-1 font-mono text-[11px] font-medium tracking-wider text-muted-foreground uppercase">
        Historial
      </h2>

      {loading ? (
        <div className="flex flex-col gap-2 p-1">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-5/6" />
        </div>
      ) : items.length === 0 ? (
        <Empty className="border p-4">
          <EmptyHeader>
            <EmptyTitle>Sin preguntas todavía</EmptyTitle>
            <EmptyDescription>
              Sus preguntas y respuestas se guardan aquí.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1 overflow-y-auto">
          {items.map((item) =>
            confirmingId === item.id ? (
              <ConfirmInline
                key={item.id}
                render={<li />}
                prompt="¿Eliminar esta pregunta del historial?"
                confirmLabel="Eliminar"
                onConfirm={() => {
                  setConfirmingId(null);
                  onDelete(item.id);
                }}
                onCancel={() => setConfirmingId(null)}
              />
            ) : (
              <li key={item.id} className="group/item flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onSelect(item)}
                  className={cn(
                    "flex min-w-0 flex-1 flex-col items-start gap-0.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                    selectedId === item.id && "bg-muted",
                  )}
                >
                  <span className="w-full truncate text-sm">
                    {item.question}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                    {dateFormat.format(new Date(item.created_at))}
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Eliminar: ${item.question}`}
                  // Hidden until the row is hovered or the control is focused — and shown
                  // outright where hover does not exist: Tailwind's `hover:` only fires
                  // under `@media (hover: hover)`, so on a phone the button was invisible
                  // and undeletable (#138, the mobile Safari pass).
                  className="text-muted-foreground opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 no-hover:opacity-100 hover:text-destructive"
                  onClick={() => setConfirmingId(item.id)}
                >
                  <Trash2 />
                </Button>
              </li>
            ),
          )}
        </ul>
      )}
    </nav>
  );
}
