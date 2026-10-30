"use client";

/**
 * The inline source reference: a claim's `[k]` marker, drawn as a miniature
 * of the sello it stands for — the same red, ground and double rule, at the
 * size of a superscript.
 *
 * It used to be a `#fragment` link that jumped down to the sello row and
 * ringed the stamp there; the reader then had to scroll back to the claim.
 * Now the source comes to the claim instead. Hovering the chip opens the
 * same card the sello shows (#478) — full title, norma, and a way out to
 * the official page — and a click or tap pins it open until Esc, a press
 * outside, or a second press on the chip. Touch has no hover, so on a phone
 * the tap is how the card opens at all. The sello row below is unchanged.
 *
 * While a card is open, every other chip citing the same source lights its
 * rule — the number is what says "these claims share a source", and this
 * makes it say so without the reader comparing digits.
 *
 * The chip is an inline `<span role="button">`, not a `<button>`: a button is
 * an atomic inline box, and the line may break before one, stranding a
 * lone "1" at the start of a line. A plain inline span has no break
 * opportunity between the word and its digit, so the reference always rides
 * with the word it qualifies.
 */
import { Popover } from "@base-ui/react/popover";
import * as React from "react";

import { selloLabel } from "@/components/sello";
import {
  SourcePreview,
  sourceHost,
  sourcePreviewPopupClassName,
} from "@/components/sello-link";
import type { Citation } from "@/lib/citations";
import { cn } from "@/lib/utils";

const ActiveReference = React.createContext<{
  active: number | null;
  setActive: React.Dispatch<React.SetStateAction<number | null>>;
} | null>(null);

/** One answer's chips: tracks which source has its card open. */
export function ReferenceScope({ children }: { children: React.ReactNode }) {
  const [active, setActive] = React.useState<number | null>(null);
  const value = React.useMemo(() => ({ active, setActive }), [active]);
  return (
    <ActiveReference.Provider value={value}>
      {children}
    </ActiveReference.Provider>
  );
}

export function CitationRef({
  ordinal,
  citation,
}: {
  ordinal: number;
  citation: Citation;
}) {
  const scope = React.useContext(ActiveReference);
  const [open, setOpen] = React.useState(false);
  const [pinned, setPinned] = React.useState(false);
  const host = citation.url ? sourceHost(citation.url) : null;

  const change = (next: boolean) => {
    setOpen(next);
    if (!next) setPinned(false);
    scope?.setActive((active) =>
      next ? ordinal : active === ordinal ? null : active,
    );
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next, details) => {
        // The press is handled by `onClick` below: it pins, never toggles a
        // hover-opened card shut.
        if (details.reason === "trigger-press") return;
        // A pinned card stays put when the pointer leaves; Esc, a press
        // outside and focus leaving still close it.
        if (!next && pinned && details.reason === "trigger-hover") return;
        change(next);
      }}
    >
      <Popover.Trigger
        openOnHover
        delay={250}
        closeDelay={150}
        nativeButton={false}
        render={<span />}
        aria-label={`Fuente ${ordinal}: ${selloLabel(citation)}`}
        data-slot="citation-ref"
        data-sibling={!open && scope?.active === ordinal ? "" : undefined}
        onClick={() => {
          if (pinned) return change(false);
          setPinned(true);
          if (!open) change(true);
        }}
        className={cn(
          "relative -top-[0.4em] ml-0.5 cursor-pointer rounded-[2px] border border-sello-border bg-sello-bg px-[3px] py-px font-mono text-[0.59375rem] leading-none font-medium text-sello tabular-nums shadow-[inset_0_0_0_1px_var(--sello-bg)] transition-colors duration-150 ease-out select-none",
          "hover:border-sello hover:bg-sello hover:text-background data-popup-open:border-sello data-popup-open:bg-sello data-popup-open:text-background data-sibling:border-sello",
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
          // Past the 15px chip, the tap area grows invisibly on touch.
          "pointer-coarse:after:absolute pointer-coarse:after:-inset-x-1 pointer-coarse:after:-inset-y-2 pointer-coarse:after:content-['']",
        )}
      >
        {ordinal}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          side="bottom"
          align="start"
          sideOffset={8}
          collisionPadding={8}
          className="isolate z-50"
        >
          <Popover.Popup
            data-slot="citation-preview"
            className={sourcePreviewPopupClassName}
          >
            <SourcePreview citation={citation} />
            {citation.url && host && (
              <a
                href={citation.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1.5 inline-flex w-fit items-center gap-1.5 rounded-[5px] border border-sello-border bg-sello-bg px-2 py-1 text-xs font-medium text-sello transition-colors duration-150 hover:border-sello focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Abrir en {host} <span aria-hidden>↗</span>
              </a>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
