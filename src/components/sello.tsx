/**
 * The sello — citation chip and signature component (DESIGN §5, issue #22).
 *
 * Geist Mono 11px/500 uppercase on `--sello-bg` with the double rule (1px
 * outer border + inset ring). The chip IS the link: it opens the official
 * source; nothing underlines. Entrance is the stamp settle — scale 1.06 → 1
 * with fade, 180ms ease-out-quart — declared in globals.css and disabled
 * under `prefers-reduced-motion` via `motion-reduce:animate-none`.
 */
import { CR_UTC_OFFSET_MS } from "@/lib/cr-time";
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
  retencion: "Retención",
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

/** Month abbreviations as Costa Rica writes them — «set», not «sept». */
const MONTHS_ES = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "set",
  "oct",
  "nov",
  "dic",
];

/**
 * `consultado el 6 ago 2026` — how current the corpus's copy of a document is
 * (#135). This is the only freshness fact we actually have: `effective_date`
 * is unpopulated and structured vigencia extraction is post-launch (#121), so
 * a source with no `fetched_at` gets no caption rather than an invented one.
 * The month table is spelled out instead of delegated to `Intl` because
 * abbreviated Spanish months drift between ICU versions («ago» vs «ago.»),
 * and this string sits in the trust surface. The date itself is read on the
 * Costa Rica calendar — the same fixed shift the daily quota uses (#125) —
 * so the caption is identical on the server and in the browser, which a
 * locale/TZ-dependent format would not be.
 */
export function fetchedLabel(
  fetchedAt: string | null | undefined,
): string | null {
  if (!fetchedAt) return null;
  const parsed = new Date(fetchedAt);
  if (Number.isNaN(parsed.getTime())) return null;
  const cr = new Date(parsed.getTime() - CR_UTC_OFFSET_MS);
  const month = MONTHS_ES[cr.getUTCMonth()];
  return `consultado el ${cr.getUTCDate()} ${month} ${cr.getUTCFullYear()}`;
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
      className={cn(
        "flex list-none flex-wrap items-start gap-x-2 gap-y-3 p-0",
        className,
      )}
    >
      {citations.map((citation, i) => {
        const consultado = fetchedLabel(citation.fetchedAt);
        return (
          <li
            key={`${citation.docKey} ${citation.articulo ?? ""}`}
            id={anchorPrefix ? selloAnchorId(anchorPrefix, i + 1) : undefined}
            className="flex scroll-mt-24 flex-col items-start gap-1 rounded-[3px] target:outline-2 target:outline-offset-2 target:outline-ring"
          >
            <Sello citation={citation} />
            {consultado && (
              // The stamp's anatomy is fixed (DESIGN §5) — the date is a
              // caption under it, in the 11px mono meta slot, never inside
              // the chip.
              <span className="px-[1px] font-mono text-[0.6875rem] text-muted-foreground">
                {consultado}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
