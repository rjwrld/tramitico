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
goes past five sentences, the cap `steps.test.ts` already pins. Then the probe
decides: a sentence that brings nothing in, or displaces a target, is dropped.

## The sentences

Four sentences were drafted and probed, and two ship. Each draft is in its
chunk's own words, one step per sentence. Its
`websearch_to_tsquery('spanish', …)` matches on the strict AND branch (the
`search_chunks` step legs, `supabase/migrations/20260907120000_search_chunks_step_legs.sql`)
and ranks its target first by `ts_rank_cd`. These checks were read-only SQL on
the shared local stack (query below). The last two columns are the probe's
production configuration (`top8/capoff/pinon`), before → after.

| #554 row | Case                          | Family | Target                                     | Strict matches | Target rank | In the answer set | Fused pool rank | Ships   |
| -------- | ----------------------------- | ------ | ------------------------------------------ | -------------- | ----------- | ----------------- | --------------- | ------- |
| 5        | `inscripcion-tardia-sancion`  | T1-I   | `tribu-cr-faq` · Declaraciones del RUT · 2 | 1              | 1           | no → **yes**      | — → #2          | yes     |
| 14       | `ho-cliente-espana-lleva-iva` | T1-D   | `ley-iva` · Artículo 3                     | 1              | 1           | no → **yes**      | #9 → #2         | yes     |
| 8        | `ho-desde-cuanta-plata-caja`  | T1-B   | `ccss-faq` · ¿Dónde puedo pagar mi seguro? | 1              | 1           | no → no           | #33 → #6        | dropped |
| 20       | `ho-minimo-renta-2026`        | T1-E   | `reglamento-renta` · Artículo 12           | 2              | 1           | no → no           | — → #24         | dropped |

- **Row 5** reuses T1-A's fourth sentence word for word. It already reaches the
  same chunk from T1-A, but T1-I classifies `inscripcion-tardia-sancion`, so
  the case never saw it.
- **Row 14**'s carrier is one of the case's expected targets: that case's
  targets in the set go 3 → 4.
- **Row 8** (the requirement's «dónde se paga la cuota» half) and **row 20**
  were dropped, not tuned. Neither brought its carrier into the set, and row
  8's pick displaced an expected target (below).

T1-D and T1-I go from four sentences to five. T1-B and T1-E end where they
started.

`pnpm tier1-miss-causes` over #512's two final lanes, with the shipped
catalogue, marks rows 5 and 14 «Catalogue: yes». It said yes for all four
drafts, which shows its «Catalogue» column reads the `reaches` lists: a
reachable carrier is not one that reaches the answer set.

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

Before: #561's committed after arm,
[`../2026-10-09-561/probe-after.json`](../2026-10-09-561/probe-after.json)
(main's code with `STEP_PINS=2`). After: `pnpm answer-set-probe` on every case
from this branch, with the four drafted sentences and #561's rewrites replayed,
so both arms cut the same pools:

```
export ANSWER_EFFORT=low
EVAL_REWRITES=<worktree>/eval/runs/2026-10-09-561/probe-after.json PROBE_CASE_MS=3000 \
  pnpm answer-set-probe eval/runs/2026-10-09-562/probe-after.json
```

Files: [`probe-after.json`](probe-after.json) and
[`probe-after-20261009T023257Z.log`](probe-after-20261009T023257Z.log). No
rerank reading was lost (650 of 650). The read is [`compare.mjs`](compare.mjs),
free: `node eval/runs/2026-10-09-562/compare.mjs`.

Across all 116 cases: **no case's hit changed**, and only one case has fewer
expected targets in its set. That one is row 8's, the reason that sentence was
dropped.

What each sentence pushed out of an answer set:

- **Row 5 (T1-I).** On `inscripcion-tardia-sancion` and three robustness
  variants of the T1-I seeds (`rb-pill-inscribi-tarde`, `rb-corto-multa-tarde`,
  `rb-seguimiento-de-cuanto-multa`), the new pick replaces
  `tribu-cr-res-0011-2025` Artículo 2, T1-I's TRIBU-CR channel sentence's pick.
  That chunk is not an expected target of any of the four, and #554 did not
  count it as row 5's carrier. `ho-rebajar-multa-si-pago-ya` gains the chunk
  without losing one (11 → 12). `multa-iva-no-declarado`'s set doesn't change.
- **Row 14 (T1-D).** `ley-iva` Artículo 3 enters 18 T1-D sets, Tier 2 and abstention
  cases included. What it displaces is none of those cases' expected targets:
  - `ley-iva` 27 on `ho-cliente-espana-lleva-iva`, `iva-facturas-en-dolares`,
    `rb-corto-tasa-iva` and `ho-abs-iva-2027`;
  - `ley-iva` 10 on `ho-hasta-que-dia-tengo-iva`, `iva-clientes-fuera-cr`,
    `iva-ajuste-bien-de-capital`, `rb-pill-iva-exterior` and
    `rb-spanglish-client-usa`;
  - `reglamento-iva` 11 on six cases, including `ho-iva-en-cero-sin-facturar`;
  - `cnpt` 79 on `iva-declaracion-mensual`;
  - `ley-iva` 11 on both export cases.

  On the three T1-D Tier 1 cases, no displaced fragment carries one of that
  case's `requiredClaims` or `requiredSteps`. `ley-iva` 27 and `reglamento-iva` 40
  stay in the sets of the two deadline cases, and `cnpt` 79 in
  `ho-iva-en-cero-sin-facturar`'s. The `$comment`'s trade-off doesn't move:
  `ley-iva` 21 was already outside `ho-t2-credito-iva-compras`'s fused 40 in
  the before arm, and still is.

- **Row 8 (T1-B, dropped).** Its pick took «¿Cuándo me corresponde pagar mi
  seguro…?» from `ho-donde-me-afilio-caja`, an expected target and #561's
  row 9 carrier (that case's targets go 2 → 1). It took the same chunk from
  `ccss-obligacion-ingreso-bajo`, and «¿Dónde me corresponde realizar el
  trámite…?» from `rb-pill-asegurarme-gano-poco`.
- **Row 20 (T1-E, dropped).** It reached the set of `renta-declaracion-plazo`
  and `rb-corto-tramos-renta` in place of a `ley-renta` 8 fragment. It never
  reached the set of the case it was written for.

**Noise floor.** A family's sentences are searched only when a question
classifies to that family, so cases in the five unchanged families should not
move. Some did: one set (`iva-retencion-tarjetas-porcentaje`, T1-F), one pool
(`inscripcion-hacienda-clientes-extranjero`, T1-A), four unclassified cases'
pools, and the order within many sets. Treat a single-fragment swap as noise
unless it repeats.

**Not re-probed.** The shipped catalogue is this arm minus the T1-B and T1-E
sentences. The other families' entries are unchanged, so T1-D and T1-I cases
get what this arm measured, and T1-B and T1-E cases get what the before arm
measured.

**Cost ≈US$0.15**: the probe's usual figure for every case, as #561
recorded it. Replaying the rewrites spent no Haiku calls on expansion or
condensation, so this arm cost at most that: embeds plus 650 rerank readings.

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
