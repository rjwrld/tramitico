import Link from "next/link";
import {
  ACERCA_LINK_LABEL,
  ACERCA_PATH,
  PRIVACY_LINK_LABEL,
  PRIVACY_PATH,
  TERMS_LINK_LABEL,
  TERMS_PATH,
} from "@/components/chat/privacy-note";
import { REPOSITORY_URL } from "@/lib/site";
import { cn } from "@/lib/utils";

/** The repository link's label: the code is public, and so is how it was built. */
export const CODE_LINK_LABEL = "Código";

const LINKS = [
  { href: ACERCA_PATH, label: ACERCA_LINK_LABEL },
  { href: PRIVACY_PATH, label: PRIVACY_LINK_LABEL },
  { href: TERMS_PATH, label: TERMS_LINK_LABEL },
  { href: REPOSITORY_URL, label: CODE_LINK_LABEL },
] as const;

/**
 * The colophon: the line at the foot of a legal document that says where it
 * came from. Here it carries the site's standing pages — about, privacy,
 * terms, the code — under the landing composer and at the foot of those
 * pages, so they stay one click away without crowding the disclosure note
 * (which keeps only the link that backs its own claim).
 *
 * Geist Mono in the 11px meta slot (DESIGN §3), muted, middots as separators:
 * an index, not navigation chrome. A `nav` with its own label so a screen
 * reader can tell it from the header's.
 */
export function Colophon({ className }: { className?: string }) {
  return (
    <nav
      aria-label="Enlaces del sitio"
      data-slot="colophon"
      className={cn(
        "font-mono text-[0.6875rem] tracking-[0.02em] text-muted-foreground",
        className,
      )}
    >
      <ul className="flex list-none flex-wrap items-center justify-center gap-x-2 gap-y-1 p-0">
        {LINKS.map(({ href, label }, index) => (
          <li key={href} className="flex items-center gap-x-2">
            {index > 0 && (
              <span aria-hidden="true" className="opacity-50">
                ·
              </span>
            )}
            <Link
              href={href}
              className="rounded-xs underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:inline-flex pointer-coarse:min-h-6 pointer-coarse:items-center"
            >
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
