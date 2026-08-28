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
 * How each `doc_key` token prints in a stamp (#214).
 *
 * The short name is derived token by token, so a token missing from this
 * table falls back to plain capitalisation — which silently mis-cased
 * acronyms (`ivm` → "Ivm") and dropped accents (`minimos` → "Minimos") on
 * documents whose own manifest titles spell them correctly. The table is
 * therefore exhaustive over `corpus/manifest.json`, and `sello.test.tsx`
 * fails if a manifest doc_key ever carries a token that is not listed here:
 * adding a document means deciding, once, how its tokens print.
 */
export const SHORT_NAME_TOKENS: Record<string, string> = {
  // Agencies, taxes and product names.
  bmc: "BMC",
  cabys: "CABYS",
  ccss: "CCSS",
  cr: "CR",
  dgt: "DGT",
  iva: "IVA",
  ivm: "IVM",
  rts: "RTS",
  tribu: "TRIBU",
  // Roman numerals used in título/transitorio keys.
  ii: "II",
  iii: "III",
  iv: "IV",
  vi: "VI",
  vii: "VII",
  viii: "VIII",
  // Words whose display form carries an accent.
  codigo: "Código",
  electronica: "Electrónica",
  electronicos: "Electrónicos",
  guia: "Guía",
  minimos: "Mínimos",
  resolucion: "Resolución",
  retencion: "Retención",
  titulo: "Título",
  // Plain words — listed so the completeness check is a real check.
  bienes: "Bienes",
  capital: "Capital",
  comprobantes: "Comprobantes",
  dev: "Dev",
  disposiciones: "Disposiciones",
  escala: "Escala",
  export: "Export",
  ley: "Ley",
  reglamento: "Reglamento",
  renta: "Renta",
  salarios: "Salarios",
  salud: "Salud",
  servicios: "Servicios",
  tarjetas: "Tarjetas",
  tramos: "Tramos",
  // Norm numbers and the version the Hacienda disposiciones are known by.
  "2026": "2026",
  "9635": "9635",
  "10363": "10363",
  v44: "v4.4",
};

/** `reglamento-iva` → `Reglamento IVA` — the stamp's doc short-name. */
export function docShortName(docKey: string): string {
  return docKey
    .split("-")
    .filter(Boolean)
    .map((token) =>
      // `hasOwn`, not `??`: a token spelled like an Object.prototype member
      // ("constructor") would otherwise resolve to the inherited value and
      // slip past the completeness check the table exists to support.
      Object.hasOwn(SHORT_NAME_TOKENS, token)
        ? SHORT_NAME_TOKENS[token]
        : token.charAt(0).toUpperCase() + token.slice(1),
    )
    .join(" ");
}

/**
 * `Reglamento IVA · Art. 11` — doc short-name · artículo. Only "Artículo"
 * abbreviates; transitorios and the preámbulo keep their full names.
 */
export function selloLabel(citation: Citation): string {
  const doc = docShortName(citation.docKey);
  if (!citation.articulo) return doc;
  // The chunker's ART_RE emits all-caps `ARTÍCULO N` headings, so the match
  // is case- and accent-insensitive the way `articuloAnchorKey` is (#214).
  const articulo = citation.articulo.replace(/^art[íi]culo(?=\s)/i, "Art.");
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
