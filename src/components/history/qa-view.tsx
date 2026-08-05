// Client component via its importers (history-shell); no "use client" here so
// function props don't get flagged as server-action boundaries.
// Restored Q&A view for a saved history item. #21's live answer view owns the
// full citation treatment; this renders the persisted snapshot.

import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";

import type { HistoryItem } from "./history-sidebar";

function citationLabel(citation: unknown): string | null {
  if (typeof citation === "string") return citation;
  if (citation && typeof citation === "object") {
    const c = citation as Record<string, unknown>;
    for (const key of ["label", "title", "article", "doc_key"]) {
      if (typeof c[key] === "string") return c[key] as string;
    }
  }
  return null;
}

export function QAView({
  item,
  onBack,
}: {
  item: HistoryItem;
  onBack: () => void;
}) {
  const citations = (Array.isArray(item.citations) ? item.citations : [])
    .map(citationLabel)
    .filter((label): label is string => label !== null);

  return (
    <article className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 px-6 py-8">
      <div>
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft data-icon="inline-start" />
          Volver
        </Button>
      </div>
      <h1 className="font-serif text-2xl font-semibold tracking-tight">
        {item.question}
      </h1>
      <p className="text-sm whitespace-pre-wrap">{item.answer}</p>
      {citations.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {citations.map((label, i) => (
            <li
              key={i}
              className="rounded-sm border border-sello-border bg-sello-bg px-2 py-1 font-mono text-[11px] font-medium tracking-wider text-sello uppercase"
            >
              {label}
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
