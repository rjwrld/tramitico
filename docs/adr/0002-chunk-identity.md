# ADR 0002 — Chunk identity and artículo-boundary detection

Date: 2026-07-21 · Status: accepted · Context: first full ingestion run ([PR #16](https://github.com/rjwrld/tramitico/pull/16))

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
