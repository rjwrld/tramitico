# ADR 0006 — Coverage-scaled fallback fusion, wider legs, structural corroboration

Date: 2026-08-06 · Status: accepted ·
Context: issue [#51](https://github.com/rjwrld/tramitico/issues/51), tuning the fusion
semantics ADR [0005](0005-lexical-and-or-fallback.md) chartered to the #25 eval.
Migration: `supabase/migrations/20260806140000_search_chunks_coverage_fusion.sql`.

## Context

The #25 eval surfaced a pool-absence gap: for *¿Cuál es la tarifa general del IVA…?*, the
canonical source `ley-iva · Artículo 10` ("La tarifa del impuesto es del trece por ciento…")
never entered the fused pool at all. Measured on the 793-chunk voyage-3 corpus (2026-08-06):

- **Vector leg: rank #34** — below the leg's top-20 cut. Longer tarifa-adjacent chunks
  (transitorios, Art. 11 tarifa reducida, reglamento Art. 23) sit closer to the question.
- **Lexical leg: rank #372 of 541** — the strict AND matches nothing, so ADR 0005's OR
  fallback fires; the chunk matches **1 of 8** query lexemes (`tarif` — its text says "tarifa
  del impuesto", never "IVA" or "general"). 541/793 chunks match that OR: the flood the
  ADR 0005 consequences section predicted, measured.

The reranker can only reorder what is in the pool, so pool absence is unfixable downstream.
And no reweighting can rescue the lexical leg here — a 1-of-8-lexeme match *should* rank
low. The chunk has to arrive through the vector leg, which means the leg cut and the
fusion's flood behavior are the real levers.

## Decision

Three coupled changes to `search_chunks`, one consumer change:

1. **Legs widen 20 → 50** (`LEG_LIMIT`). Vector #34 now enters the fusion.
2. **OR-fallback contributions are coverage-scaled.** When (and only when) the ADR 0005
   fallback fires, each lexical hit's RRF contribution becomes
   `(matched lexemes / query lexemes) × 1/(k + rank)`. One-term flood matches collapse
   toward zero; genuinely corroborated chunks keep most of their weight. The strict AND
   branch is untouched — every match there has full coverage by construction, so its
   scores are byte-identical.
3. **Per-leg ranks are returned** (`vector_rank`, `lexical_rank`, null = leg missed it),
   and the weak-retrieval signal becomes structural: `isWeak` = no returned chunk in both
   legs (`isCorroborated` in `retrieval.ts`). The old `WEAK_SCORE_THRESHOLD =
   2/(k + LEG_LIMIT)` arithmetic depended on every leg contribution being a full
   `1/(k + rank)`; coverage scaling breaks that, so the threshold is gone.
4. **`RERANK_POOL` 30 → 40.** With the changes above, Art. 10 fuses at **#38**: vector #34,
   minus the coverage-crushed flood, plus a handful of corroborated chunks above it. A pool
   of 30 still misses it; 40 reaches it and is still one Voyage rerank call. Issue #51's
   acceptance was amended accordingly ("fused pool of 30" → "pool handed to the reranker").

## Why not the alternatives

- **Min-2-content-word filter on the fallback** (from the #51 candidate list) — would
  remove Art. 10 from the lexical leg entirely (it matches one lexeme) and, unlike
  scaling, throws away rather than downweights partial evidence.
- **Per-artículo score pooling** — Art. 10 is a single unsplit chunk; there is nothing to
  pool. Solves a different (real) problem, not this one.
- **Ingestion-side alias enrichment** (append "IVA" to ley-iva/reglamento-iva chunks) —
  might lift the vector rank, but the outcome is unknowable without a full re-embed, and
  it mutates the corpus for every future ingest. Held in reserve if a future case needs
  vector rank improved rather than the pool widened.

## Consequences

- **Fallback queries' fused order now favors the vector leg.** Under coverage scaling the
  pool becomes essentially "vector top-N plus genuinely corroborated chunks" — the ADR
  0003/0005 canary pathology (generic OR hits corroborating each other above single-leg
  targets) shrinks with it. The known-risk partial-match case, *prescripción retroactivo
  CCSS*, keeps 2/3 of its lexical weight and survives comfortably (#25 eval stays 25/25,
  re-measured after this change).
- **Exact-term (strict AND) queries are unaffected in ordering**; they only gain leg
  members at ranks 21–50, which existing top ranks outscore.
- **`fuseRrf` reference impl takes weighted entries** so the integration cross-check can
  keep proving the SQL and TypeScript fusion identical; a lexical-only row's weight is
  recoverable as `score / rrfScore(lexical_rank)`.
- **Callers of `search_chunks` see two new columns.** The eval logs per-leg ranks free of
  charge; any future fusion tuning can re-derive both legs from one RPC call.
- Coverage counting probes each candidate's tsv once per query lexeme (≤50 rows × ~8
  lexemes, GIN-indexed) — negligible at this corpus size.
