"use client";

/**
 * The linked sello with its source preview (#478).
 *
 * The chip names a document in short form — `LEY IVA · ART. 8` — and until
 * now the full title and norma lived only on `/acerca`. Hovering or focusing
 * the chip now opens a card with them, and with the official host the link
 * goes to. The chip stays the link (DESIGN §5: the chip IS the link): Base
 * UI's preview-card trigger renders the `<a>` itself, so the card adds
 * information and never a second click target. Touch has no hover, so a tap
 * follows the link exactly as before.
 *
 * Its own client module so `sello.tsx` stays importable from server
 * components — `/acerca` imports its date formatters, which a `"use client"`
 * boundary would turn into client references.
 */
import { PreviewCard } from "@base-ui/react/preview-card";

import type { Citation } from "@/lib/citations";
import { cn } from "@/lib/utils";

/** What the card says about where the link goes: `sinalevi.go.cr`. */
export function sourceHost(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function SelloLink({
  citation,
  href,
  label,
  className,
}: {
  citation: Citation;
  href: string;
  label: string;
  className?: string;
}) {
  const host = sourceHost(href);
  const reference = [citation.norma, citation.articulo]
    .filter(Boolean)
    .join(" · ");
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger
        data-slot="sello"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        delay={400}
        closeDelay={150}
        className={className}
      >
        {label}
      </PreviewCard.Trigger>
      <PreviewCard.Portal>
        <PreviewCard.Positioner sideOffset={8} className="isolate z-50">
          <PreviewCard.Popup
            data-slot="sello-preview"
            className={cn(
              "flex max-w-xs origin-(--transform-origin) flex-col gap-1 rounded-lg bg-popover p-3 text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none",
              "duration-150 data-closed:animate-out data-closed:fade-out-0 data-open:animate-in data-open:fade-in-0 motion-reduce:animate-none",
            )}
          >
            <p className="text-sm leading-snug font-medium text-balance">
              {citation.docTitle}
            </p>
            {reference && (
              <p className="font-mono text-[0.6875rem] text-muted-foreground">
                {reference}
              </p>
            )}
            {host && (
              <p className="font-mono text-[0.6875rem] text-muted-foreground">
                {host} <span aria-hidden>↗</span>
              </p>
            )}
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
