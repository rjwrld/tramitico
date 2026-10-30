/**
 * How a link out of answer prose looks (DESIGN §5, "Official links"): sello
 * red, underlined only on hover, with an institution mark glued to the start
 * so the icon never ends a line on its own.
 */
import type { LucideIcon } from "lucide-react";

export const outboundClassName =
  "rounded-[2px] text-sello decoration-1 underline-offset-3 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export function MarkedText({
  icon: Icon,
  head,
  tail,
}: {
  icon: LucideIcon;
  head: string;
  tail: string;
}) {
  return (
    <>
      <span className="whitespace-nowrap">
        <Icon
          aria-hidden
          strokeWidth={1.75}
          className="mr-1 inline size-[0.95em] align-[-0.125em]"
        />
        {head}
      </span>
      {tail}
    </>
  );
}
