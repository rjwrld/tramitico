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

/** The answer's sello row — one stamp per citation, in order of use. */
export function SelloRow({
  citations,
  className,
}: {
  citations: Citation[];
  className?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <ul
      aria-label="Fuentes"
      className={cn("flex list-none flex-wrap gap-2 p-0", className)}
    >
      {citations.map((citation) => (
        <li key={`${citation.docKey} ${citation.articulo ?? ""}`}>
          <Sello citation={citation} />
        </li>
      ))}
    </ul>
  );
}
