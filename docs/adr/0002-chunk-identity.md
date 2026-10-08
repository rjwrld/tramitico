# ADR 0002 — Chunk identity and artículo-boundary detection

Date: 2026-07-21 · Status: accepted, amended 2026-08-04 (see [Amendment](#amendment-2026-08-04--fragmented-and-inline-headings)) · Context: first full ingestion run ([PR #16](https://github.com/rjwrld/tramitico/pull/16))

## Context

The SPEC §4 schema carried a unique index on `(document_id, articulo, part)` as an idempotency
guard. The first live run violated it: consolidated legal texts legitimately repeat artículo
numbers (reform decrees quoted inline carry their own "Artículo 1…"). Separately, quoted reform
references at paragraph starts ("…el artículo 304 del decreto…") matched the case-insensitive
boundary regex and produced false article chunks (a 71-artículo reglamento yielded labels up to
"artículo 304").

## Decision

1. **No unique index on chunk labels.** Ingestion idempotency comes from wholesale replacement
   (delete all chunks for the document, insert fresh) — the index added no safety, only false
   failures. A citation label (`doc · artículo`) may therefore be non-unique within a document;
   the chunk content disambiguates.
2. **Artículo boundary regex is case-sensitive on the first letter** (`Artículo` / `ARTÍCULO` /
   `Transitorio` / `TRANSITORIO`). Real headings are always capitalized; quoted mid-sentence
   references are lowercase. Result on the live corpus: 675 chunks, zero lowercase labels.

## Consequences

- Re-running ingestion for a document is safe and cheap (wholesale replace).
- Rare duplicate labels within one document are accepted for MVP; if eval shows citation
  ambiguity, disambiguation (path-qualified labels) is the follow-up.
- A capitalized quoted reference at a paragraph start would still false-positive; none exist in
  the current corpus (verified by label audit after re-ingestion).

## Amendment 2026-08-04 — fragmented and inline headings

The ADR 0003 embedding benchmark exposed that Ley IVA's SINALEVI markup defeats the
paragraph-start anchor two ways: headings fragment across extracted paragraphs
(`"Artículo"` / `"8- Exenciones…"`, and `"CAPÍTULO"` / `"III"` / `"EXENCIONES"` / `"Y TASA DEL
IMPUESTO"`), and headings glue onto the preceding capítulo text mid-paragraph. Result: whole
capítulos became `articulo=null` blobs — only 4 of Ley IVA's ~47 artículos were labeled, and
`Ley IVA · Artículo 8` (the exportación exemption, the retrieval canary's answer) did not exist
as a citable chunk.

Two pre-passes in the chunker fix this (`normalizeFragments`, `splitInlineHeadings`):

1. **Fragment rejoin** — a bare heading word followed by a number/roman fragment is merged;
   header captions (short all-caps lines) are absorbed, capped at 3.
2. **Inline split** — paragraphs split at interior capitalized headings; unlike the
   paragraph-start regex, a delimiter after the number is _required_ (`Artículo 8-`), so
   mid-sentence references ("el Artículo 8 de esta ley") don't split.

Ley IVA: 25 → 52 chunks, 4 → 47 labeled artículos, 18 → 1 unlabeled. Other docs shifted by at
most a few chunks. Residual unlabeled chunks (notably ~40 in Ley 9635) are mostly legitimate
capítulo intro text; a follow-up audit belongs to eval work (#25), not this fix.

## Amendment 2026-10-07: a paragraph-start heading needs its delimiter (#530)

The false positive this ADR's consequences called absent turned up. SINALEVI's Word export
wraps sentences at source line breaks, and `htmlToParagraphs` turns each line into a paragraph,
so `reglamento-iva`'s definition 30) put «Artículo 25 del presente Reglamento.» at a paragraph
start. The chunker opened a second «Artículo 25» under Capítulo I there, labelling Artículo 1's
definitions from 31) to 55) with the número of Capítulo VIII's Determinación del impuesto.
#508's cross-reference resolver refuses a label two artículos share, so every reference to the
real artículo 25 resolved to nothing.

The paragraph-start regex now takes the inline split's rule: a delimiter follows the número
(«.-», «-», «.—», «°.-», «º-», after any ordinal or letter suffix), or the label ends its
paragraph, which is how fragmented headings arrive before they are rejoined. #237 had already
put transitorios under the same rule. Over the cached corpus the change moves one label, and
the re-ingest bore it out: the reglamento's Artículo 1 has 6 parts and Artículo 25 is the
Capítulo VIII chunk alone.

Duplicate labels are no longer accepted silently. A unit test over `eval/corpus-index.json`
fails on any `(doc_key, artículo)` pair carried under two paths unless `ALLOWED_REPEATED_LABELS`
(`src/lib/eval/corpus-index.ts`) names it with the source's reason, and on any entry no repeat
needs. Labels compare by the resolver's own `articuloKey`, so the test calls two labels one
exactly when the resolver would. The entries are two CCSS FAQ questions published under two
sections with different answers; reglamento-iva's Artículo 25 was listed only until the
corpus-index re-dump that followed its re-ingest.
