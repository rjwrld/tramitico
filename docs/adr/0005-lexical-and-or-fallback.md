# ADR 0005 — Lexical leg: conditional AND→OR tsquery fallback in `search_chunks`

Date: 2026-08-05 · Status: accepted ·
Context: issue [#37](https://github.com/rjwrld/tramitico/issues/37), recording a decision merged
in [#33](https://github.com/rjwrld/tramitico/pull/33) (`supabase/migrations/20260723012234_search_chunks.sql`)

## Context

The lexical leg of hybrid retrieval (SPEC §5, issue #20) parses the user's question with
`websearch_to_tsquery('spanish', …)`, which ANDs every term: a chunk matches only if it contains
_all_ of them. That is the right semantics for exact-term queries — _tramos_, _CCSS_, CABYS
codes — where the terms are the query and precision is the point.

It is the wrong semantics for a full natural-language question, which is what `/api/ask` (#21)
actually sends. Strict AND returns **zero rows** whenever any one term is missing from every
chunk — including issue #20's own acceptance query, _prescripción retroactivo CCSS_:
`Ley 10.363 · ARTÍCULO 2` contains `prescripción` and `CCSS` but not `retroactivo`, so the
target chunk (and every other chunk) fails the AND. The lexical leg contributes nothing exactly
when the question is phrased the way real users phrase it, leaving retrieval single-legged.

## Decision

**Keep strict AND as the primary query; relax to an OR over the same `spanish` lexemes only
when the strict query matches no chunk at all.**

```sql
select case
  when exists (select 1 from public.chunks c
               where c.tsv @@ websearch_to_tsquery('spanish', query_text))
  then websearch_to_tsquery('spanish', query_text)
  else (select string_agg(quote_literal(l.lexeme), ' | ')
        from unnest(to_tsvector('spanish', query_text)) as l)::tsquery
end as query
```

The OR branch is built from the lexemes `to_tsvector('spanish', …)` produces for the same text,
so both branches see identical stemming and stop-word removal; the only thing that changes is
the connective.

### Why conditional, not always-OR

The fallback fires **only when strict AND matches nothing**, which means exact-term queries are
byte-for-byte unaffected: a query whose terms all co-occur somewhere in the corpus takes the
strict branch and gets AND precision, exactly as before. That invariant — _relaxation can never
degrade a query that strict matching already serves_ — is the property the design turns on, and
it is what always-OR gives up. Always-OR would let a single common term (_IVA_, _factura_)
flood the lexical leg's top-20 on every query, including the exact-term ones where the AND
semantics is doing its best work.

### Why OR is acceptable when it does fire

`ts_rank_cd` (cover density) scores chunks by how many query lexemes they match and how tightly
the matches cluster, so under the OR query the chunks matching _more_ of the question still rank
first. The fallback degrades recall-zero to best-effort ranking, not to noise-first: on
_prescripción retroactivo CCSS_, the two-of-three-term `Ley 10.363 · ARTÍCULO 2` outranks
one-term matches.

## Alternatives rejected

- **Always-OR** — rejected for the precision loss on exact-term queries described above.
- **No fallback (strict AND only)** — the shape of the competing implementation in the closed
  #35, which makes this a genuine fork rather than an obvious call. Rejected because it fails
  #20's acceptance criteria on natural-language questions: the lexical leg silently returns
  nothing and hybrid retrieval quietly becomes vector-only for the majority query shape.

## Consequences

- **#21 (`/api/ask`) and #25 (eval) inherit two lexical regimes**, selected per-query by corpus
  state, invisible to the caller. A query's lexical results can change branch as the corpus
  grows (a term newly co-occurring flips it from OR back to AND).
- **The eval set (#25) must exercise both branches** — at least one exact-term query that stays
  on strict AND and one natural-language query that trips the fallback — otherwise the fallback
  is untested in aggregate and a regression in either branch is invisible.
- **Known cost, measured:** on the canary question (_¿Debo cobrar IVA en facturas a clientes
  fuera de Costa Rica?_) the OR branch matches near-everything (_IVA_, _factura_, _Costa Rica_),
  and under RRF those corroborated generic hits outscore the single-leg vector targets, pushing
  them below ~#20 — see the
  [canary section of ADR 0003](0003-embedding-provider.md#canary-status-on-the-re-chunked-re-embedded-corpus-711-chunks).
  That is a fusion-tuning problem (top-k, leg weights), chartered to #25 with that data as its
  baseline; this ADR records the branch semantics it will be tuning around.
- The extra `exists` probe costs one indexed `tsv @@ tsquery` check per call before the leg
  itself runs — negligible against the GIN index.

## Note on numbering

Issue #37 originally reserved the name "ADR 0003" and its thread later renamed the write-up to
"ADR 0004"; both slots were taken by the time of writing
([0003 — embedding provider](0003-embedding-provider.md),
[0004 — citation rendering](0004-citation-rendering.md)), so this document is ADR 0005.
