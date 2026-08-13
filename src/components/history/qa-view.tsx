// Client component via its importers (history-shell); no "use client" here so
// function props don't get flagged as server-action boundaries.
// Restored Q&A view for a saved history item. Renders the persisted citation
// snapshot through the same Sello treatment as the live answer (#21/ADR
// 0004) rather than a parallel label mapping — see issue #94.

import { ArrowLeft } from "lucide-react";

import { AnswerProse } from "@/components/chat/answer-prose";
import { SelloRow } from "@/components/sello";
import { Button } from "@/components/ui/button";
import { dropUnbackedMarkers } from "@/lib/answer/citations";
import { isCitation } from "@/lib/citations";

import type { HistoryItem } from "./history-sidebar";

export function QAView({
  item,
  onBack,
}: {
  item: HistoryItem;
  onBack: () => void;
}) {
  // `item.citations` comes back through a `Json` column (issue #61) — filter
  // rather than throw so a malformed or legacy-shaped entry just drops out
  // instead of blanking the whole row.
  const citations = (
    Array.isArray(item.citations) ? item.citations : []
  ).filter(isCitation);

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
      {/* Same prose treatment as the live answer (#77): the snapshot carries
          the same bullets, bold and tables the model wrote — and, since #133,
          its markers already number the sellos, so there is nothing to
          resolve, only orphans to drop. Rows saved before #133 have no
          markers at all and simply render without superscripts. */}
      <AnswerProse
        text={dropUnbackedMarkers(item.answer, citations.length)}
        references={{ count: citations.length, anchorPrefix: item.id }}
      />
      <SelloRow citations={citations} anchorPrefix={item.id} />
    </article>
  );
}
