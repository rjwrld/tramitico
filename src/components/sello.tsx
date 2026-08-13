/**
 * The sello — citation chip and signature component (DESIGN §5, issue #22).
 *
 * Geist Mono 11px/500 uppercase on `--sello-bg` with the double rule (1px
 * outer border + inset ring). The chip IS the link: it opens the official
 * source; nothing underlines. Entrance is the stamp settle — scale 1.06 → 1
 * with fade, 180ms ease-out-quart — declared in globals.css and disabled
 * under `prefers-reduced-motion` via `motion-reduce:animate-none`.
 */
import type { Citation } from "@/lib/retrieval";
import { cn } from "@/lib/utils";

/**
 * Tokens of a `doc_key` that print as-is (uppercased): agency and tax
 * acronyms plus roman numerals used in título/transitorio keys.
 */
const UPPER_TOKENS = new Set([
  "iva",
  "ccss",
  "cabys",
  "bmc",
  "mtss",
  "rts",
  "cr",
  "ii",
  "iii",
  "iv",
  "vi",
  "vii",
  "viii",
]);

/** doc_key words whose display form carries an accent. */
const ACCENTED: Record<string, string> = {
  titulo: "Título",
  codigo: "Código",
  resolucion: "Resolución",
  electronica: "Electrónica",
  electronicos: "Electrónicos",
};

/** `reglamento-iva` → `Reglamento IVA` — the stamp's doc short-name. */
export function docShortName(docKey: string): string {
  return docKey
    .split("-")
    .filter(Boolean)
    .map((token) => {
      if (UPPER_TOKENS.has(token)) return token.toUpperCase();
      const accented = ACCENTED[token];
      if (accented) return accented;
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(" ");
}

/**
 * `Reglamento IVA · Art. 11` — doc short-name · artículo. Only "Artículo"
 * abbreviates; transitorios and the preámbulo keep their full names.
 */
export function selloLabel(citation: Citation): string {
  const doc = docShortName(citation.docKey);
  if (!citation.articulo) return doc;
  const articulo = citation.articulo.replace(/^Artículo(?=\s)/, "Art.");
  return `${doc} · ${articulo}`;
}

const selloClassName = cn(
  // Anatomy: mono 11px/500 uppercase, 3px radius, 5px 9px padding, double rule.
  "inline-block rounded-[3px] px-[9px] py-[5px] font-mono text-[0.6875rem] font-medium tracking-[0.03em] uppercase",
  "border border-sello-border bg-sello-bg text-sello",
  "shadow-[inset_0_0_0_3px_var(--sello-bg),inset_0_0_0_4px_var(--sello-border)]",
  "animate-stamp-settle motion-reduce:animate-none",
);

export function Sello({
  citation,
  className,
}: {
  citation: Citation;
  className?: string;
}) {
  const label = selloLabel(citation);
  if (!citation.url) {
    return (
      <span data-slot="sello" className={cn(selloClassName, className)}>
        {label}
      </span>
    );
  }
  return (
    <a
      data-slot="sello"
      href={citation.url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        selloClassName,
        "transition-colors duration-150 hover:border-sello focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        className,
      )}
    >
      {label}
    </a>
  );
}

/**
 * Anchor id for the nth seal of one answer (#133). `prefix` scopes it to that
 * answer — several are on screen at once in a chat — and is scrubbed to the
 * characters an `href="#…"` fragment can carry, since React's `useId` spells
 * its ids with punctuation (`«r0»`).
 */
export function selloAnchorId(prefix: string, ordinal: number): string {
  return `${prefix.replace(/[^A-Za-z0-9_-]/g, "")}-fuente-${ordinal}`;
}

/**
 * The answer's sello row — one stamp per citation, in order of use.
 *
 * `anchorPrefix` turns the row into the landing site for the prose's inline
 * superscripts: each stamp is numbered by its position here, and that is the
 * numbering `renumberCitationMarkers` writes into the text. The stamp itself
 * is untouched (DESIGN §5) — the id and the `:target` ring live on the `li`,
 * so a reader who follows ¹ sees which stamp lit up without the chip growing
 * a number it does not need.
 */
export function SelloRow({
  citations,
  anchorPrefix,
  className,
}: {
  citations: Citation[];
  anchorPrefix?: string;
  className?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <ul
      aria-label="Fuentes"
      className={cn("flex list-none flex-wrap gap-2 p-0", className)}
    >
      {citations.map((citation, i) => (
        <li
          key={`${citation.docKey} ${citation.articulo ?? ""}`}
          id={anchorPrefix ? selloAnchorId(anchorPrefix, i + 1) : undefined}
          className="scroll-mt-24 rounded-[3px] target:outline-2 target:outline-offset-2 target:outline-ring"
        >
          <Sello citation={citation} />
        </li>
      ))}
    </ul>
  );
}
