# Step-catalogue sentences for #554's unreached carriers, 2026-10-09 (#562)

#554 split the Tier 1 requirements #512's two final lanes missed. Of its 19
cause-2 rows (a corpus chunk carries the requirement, and the chunk reached
neither lane's answer set), 7 had a carrier no sentence in the family's step
catalogue (#304) reaches. This record covers what was written for them, what
was left out, and why.

## What #561 changed about the plan

#561 found that the other 12 carriers were all pooled: each was its own catalogue
sentence's rank-1 pick, and `pin1` cut it. `pin1` appends one pick, in
question-rank order, so the step the question didn't ask about ranks last.
#561 ships `STEP_PINS`, two picks appended in the same order. A new sentence's
pick therefore competes with the rest of its family's sentences for two slots,
and each extra sentence makes that competition harder. So this change adds a
sentence only where the carrier answers the requirement whole, and no family
goes past five sentences, the cap `steps.test.ts` already pins.

## The sentences

Each one is written in its chunk's own words, one step per sentence. Its
`websearch_to_tsquery('spanish', …)` matches on the strict AND branch (the
`search_chunks` step legs, `supabase/migrations/20260907120000_search_chunks_step_legs.sql`)
and ranks its target first by `ts_rank_cd`. These checks were read-only SQL on
the shared local stack (query below).

| #554 row | Case                          | Family | Target                                     | Strict matches | Target rank |
| -------- | ----------------------------- | ------ | ------------------------------------------ | -------------- | ----------- |
| 5        | `inscripcion-tardia-sancion`  | T1-I   | `tribu-cr-faq` · Declaraciones del RUT · 2 | 1              | 1           |
| 8        | `ho-desde-cuanta-plata-caja`  | T1-B   | `ccss-faq` · ¿Dónde puedo pagar mi seguro? | 1              | 1           |
| 14       | `ho-cliente-espana-lleva-iva` | T1-D   | `ley-iva` · Artículo 3                     | 1              | 1           |
| 20       | `ho-minimo-renta-2026`        | T1-E   | `reglamento-renta` · Artículo 12           | 2              | 1           |

- **Row 5** reuses T1-A's fourth sentence word for word. It already reaches the
  same chunk from T1-A. T1-I classifies `inscripcion-tardia-sancion`, so the
  case never saw it.
- **Row 8** covers the requirement's «dónde se paga la cuota» half.
- **Row 14**'s carrier is one of the case's expected targets.
- **Row 20**'s second strict match is `reglamento-renta` TRANSITORIO I, ranked
  below Artículo 12.

The families stay within the cap: T1-B, T1-D, T1-E and T1-I go from four
sentences to five, and none is retired.

`pnpm tier1-miss-causes` over #512's two final lanes, with this catalogue,
marks rows 5, 8, 14 and 20 «Catalogue: yes». Cause-2 rows with a carrier the
catalogue reaches go from 12 to 16 of 19.

## Left out

- **Row 8, «cómo se declara el ingreso de referencia»**: `ccss-reglamento-ti`
  Artículo 7 is the closest carrier. Its item 2 has the income declared as a
  declaración jurada at afiliación, but it says nothing about the ingreso de
  referencia. A draft sentence matched it at lexical rank 1. It was left out
  because it answers only part of the requirement, and it would compete for
  T1-B's two pinned slots with sentences that answer theirs whole.
- **Row 17, `cnpt` Artículo 88 for T1-D**: «qué hacer si la fecha ya pasó» is
  answered only indirectly. The spontaneous rebaja is a reason to file now, not
  the step itself. Left out for the same reason. A draft in Artículo 88's own
  words matched it at lexical rank 1.
- **Row 26, `ccss-reglamento-ti` Artículo 7 for T1-F**: no chunk describes
  registering both conditions as one step, and the afiliación duty is a partial
  carrier. T1-F is also at five sentences already. If Artículo 7 doesn't count,
  #554 makes this row cause 1.
- **Row 16, the TRIBU-CR channel for T1-D**: stays open. No IVA-specific channel
  chunk exists: searching the corpus for the IVA declaration alongside the
  Oficina Virtual or TRIBU-CR, and for D-104, finds only RUT FAQs and
  `tribu-cr-res-0011-2025` Artículos 1 and 8. The one carrier, Artículo 2, is
  the T1-D sentence the catalogue's `$comment` records as measured and dropped.
  It pushed `ley-iva` Artículo 21 out of the fused 40 on
  `ho-t2-credito-iva-compras` in six runs of six. `STEP_PINS` could change the
  other half of that record («never reached T1-D's answer set under `pin1`»),
  but not the pool push.

## Found: 8 of the catalogue's 38 existing sentences miss the strict branch

8 of the 38 sentences committed before this change get **no** strict
`websearch_to_tsquery` match on the local corpus, so their lexical leg runs on
the OR fallback, where coverage weights the rank:

- T1-A#2
- T1-D#3
- T1-E#1
- T1-F#2
- T1-H#1
- T1-H#3
- T1-I#1, the sentence that carries `cnpt` 88 for T1-I
- T1-I#3

T1-D#3 and T1-I#3 join two chunks' facts in one sentence on purpose. The others
read as paraphrases that drifted from their chunk's words. That goes against
the `$comment`'s claim that a sentence «wins the lexical leg's strict AND
branch outright». Not fixed here: rewording a sentence is a retrieval change of
its own.

## Probe

Pending, after #561 merges. The before arm is #561's committed after JSON. The
after arm replays its rewrites (`EVAL_REWRITES`) with this catalogue, on top of
`STEP_PINS`.

## Reproduce the lexical check

```sql
with drafts(label, sentence, target) as (values
  ('20', 'El período fiscal del Impuesto sobre las Utilidades es de un año, comprendido entre el 1 de enero y el 31 de diciembre de cada año.', '04976fb8')
  -- one row per sentence; target is the chunk id's first 8 characters
), ranked as (
  select d.label, left(c.id::text, 8) as id,
    row_number() over (
      partition by d.label
      order by ts_rank_cd(c.tsv, websearch_to_tsquery('spanish', d.sentence)) desc, c.id
    ) as rk
  from drafts d
  join public.chunks c on c.tsv @@ websearch_to_tsquery('spanish', d.sentence)
)
select d.label, count(r.id) as strict_matches,
  max(r.rk) filter (where r.id = d.target) as target_rank
from drafts d left join ranked r on r.label = d.label
group by d.label;
```
