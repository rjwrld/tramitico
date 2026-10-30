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
import type * as React from "react";

import { MarkedText, outboundClassName } from "@/components/chat/outbound";
import { useCopiedFlag } from "@/components/chat/use-copied-flag";
import { cn, hasFinePointer } from "@/lib/utils";

export const COPIED_EMAIL_LABEL = "Copiado";

/**
 * Whether this activation copies rather than opens the mail app. The click's
 * own pointer decides — a tap on a touchscreen laptop still opens mail — and
 * a keyboard press (no pointer) follows the device's primary pointer.
 */
function copiesOnClick(event: React.MouseEvent): boolean {
  const { pointerType } = event.nativeEvent as Partial<PointerEvent>;
  return pointerType ? pointerType === "mouse" : hasFinePointer();
}

export function OfficialEmail({ address }: { address: string }) {
  const [copied, flashCopied] = useCopiedFlag();
  const at = address.lastIndexOf("@");
  const href = `mailto:${address}`;

  return (
    <span className="relative">
      <a
        href={href}
        className={outboundClassName}
        onClick={(event) => {
          if (!copiesOnClick(event) || !navigator.clipboard) return;
          event.preventDefault();
          navigator.clipboard
            .writeText(address)
            .then(flashCopied, () => window.location.assign(href));
        }}
      >
        <MarkedText
          icon={MailIcon}
          head={address.slice(0, at)}
          tail={address.slice(at)}
        />
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
