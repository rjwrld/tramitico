"use client";

/**
 * An official address in answer prose (`cobros@ccss.sa.cr`). With a mouse,
 * a click copies it — a desk rarely has a mail client set up, and `mailto:`
 * there opens an app nobody uses or nothing at all. On a phone the same
 * link opens the mail app, which always exists. A refused clipboard falls
 * back to the `mailto:`.
 *
 * Only reached for a domain `isOfficialEmail` accepts; the address itself is
 * matched by answer-prose's pattern, so no model text but a plain address
 * reaches the `href`.
 */
import { MailIcon } from "lucide-react";
import * as React from "react";

import { cn } from "@/lib/utils";

export const COPIED_EMAIL_LABEL = "Copiado";
const COPIED_DISPLAY_MS = 1400;

export function OfficialEmail({
  address,
  className,
}: {
  address: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);
  React.useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [copied]);
  const at = address.lastIndexOf("@");
  const href = `mailto:${address}`;

  return (
    <span className="relative">
      <a
        href={href}
        className={className}
        onClick={(event) => {
          const desk = window.matchMedia?.(
            "(hover: hover) and (pointer: fine)",
          ).matches;
          if (!desk || !navigator.clipboard) return;
          event.preventDefault();
          navigator.clipboard.writeText(address).then(
            () => setCopied(true),
            () => window.location.assign(href),
          );
        }}
      >
        <span className="whitespace-nowrap">
          <MailIcon
            aria-hidden
            strokeWidth={1.75}
            className="mr-1 inline size-[0.95em] align-[-0.125em]"
          />
          {address.slice(0, at)}
        </span>
        {address.slice(at)}
      </a>
      <span
        aria-live="polite"
        className={cn(
          "pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 rounded-[5px] bg-foreground px-1.5 py-1 font-mono text-[0.6875rem] leading-none whitespace-nowrap text-background transition-opacity duration-150 ease-out motion-reduce:transition-none",
          copied ? "opacity-100" : "opacity-0",
        )}
      >
        {copied ? COPIED_EMAIL_LABEL : ""}
      </span>
    </span>
  );
}
