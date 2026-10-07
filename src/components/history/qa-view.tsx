// Client component via its importers (history-shell); no "use client" here so
// function props don't get flagged as server-action boundaries.
// Restored Q&A view for a saved history item. Renders the persisted citation
// snapshot through the same Sello treatment as the live answer (#21/ADR
// 0004) rather than a parallel label mapping — see issue #94.

import { ArrowLeft } from "lucide-react";

import {
  AnswerFoot,
  DISCLAIMER,
  ROUTED_DISCLAIMER,
} from "@/components/chat/answer-block";
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
  const text = dropUnbackedMarkers(item.answer, citations.length);
  // The live answer knows a decline by its `data-routed` part, which is never
  // saved. A saved row with no citations is a decline all the same — the
  // #131 invariant puts at least one on every answer — and a decline names
  // the institution to go to, so it closes on the routed line (#491).
  const disclaimer = citations.length > 0 ? DISCLAIMER : ROUTED_DISCLAIMER;

  return (
    <article className="mx-auto flex w-full max-w-[44rem] flex-col gap-4 px-safe pt-8 pb-8 [--safe-pad:1.5rem]">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="pointer-coarse:h-11"
          onClick={onBack}
        >
          <ArrowLeft data-icon="inline-start" />
          Volver
        </Button>
      </div>
      {/* A pasted question can be one unbroken string (#138) — it wraps
          rather than pushing the column wider than the phone. */}
      <h1 className="font-serif text-2xl font-semibold tracking-display wrap-break-word">
        {item.question}
      </h1>
      {/* Same prose treatment as the live answer (#77): the snapshot carries
          the same bullets, bold and tables the model wrote — and, since #133,
          its markers already number the sellos, so there is nothing to
          resolve, only orphans to drop. Rows saved before #133 have no
          markers at all and simply render without superscripts. */}
      <AnswerProse
        text={text}
        references={{ count: citations.length, anchorPrefix: item.id }}
      />
      <SelloRow citations={citations} anchorPrefix={item.id} />
      {/* DESIGN §9: the disclaimer is always present — on a saved answer as
          much as a fresh one (#491). */}
      <AnswerFoot text={text} citations={citations} disclaimer={disclaimer} />
    </article>
  );
}
