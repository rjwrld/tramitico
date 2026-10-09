# Why #561's carriers miss the answer set, 2026-10-09 (#561)

#554 found 12 Tier 1 carriers that the step catalogue already lists in its
`reaches` and that still miss both #512 answer sets. This record says where
they are lost: in the pool, at a step sentence, or at `pin1`'s single append.

## Free first

- **Wave D's lane** (`2026-10-09-497-wave-d/lane/`, main 3455dd5) still misses
  rows 1, 3, 4, 6, 9, 18 and 27. Rows 7, 11, 12 and 23–25 reached its sets.
- **Pooled.** In `2026-10-08-baseline/probe-rerank-off.json` (the current
  corpus) every carrier is in the fused 40, at #2–#26. In
  `2026-10-07-508/probe.json` they sit at fused #1–#31 and reranked #15–#40
  against the question. None is «never pooled». The one exception is
  row 9's second carrier (`ccss-faq` «…seguro voluntario, migrante…»), and
  the row's first carrier is pooled.

## The paid read: `step-picks.ts`

The probes record the pool and the question's order, not the step picks.
[`step-picks.ts`](step-picks.ts) runs the route's retrieve and rerank on the
ten cases. It captures Voyage's raw response for each reading through
`fetchImpl`, so nothing under `src/` changed. It prints each sentence's pick,
what `pin1` appends, and every carrier's fused rank, question rank and rank in
each sentence's reading. The read ran from this worktree on cdef9d6 with live
rewrites and every knob at its code default (`ANSWER_EFFORT=low` exported;
nothing here reads it). Outputs: [`step-picks-20261009T014242Z.log`](step-picks-20261009T014242Z.log)
and [`step-picks.json`](step-picks.json), whose `reads[].query`/`expansion`
`EVAL_REWRITES` can replay.

The log's `row` labels for `ccss-obligacion-ingreso-bajo` are wrong. The
script indexed `carriers.json` by table row, but the file then swapped rows 2/3
and 23/25 (and permuted 19–21), so that case printed row 2's carrier (`¿El Trabajador Independiente
está obligado…?`) under «row 3». Row 3's carrier is that case's `s1` pick in
the same log. The script now keys rows on their requirement text. Since #584
`carriers.json` is in the table's order, and `pnpm tier1-miss-causes` fails if
it drifts.

## Result

**Every carrier is its own sentence's pick, and `pin1`'s one append goes to
another pick.** No sentence picks a different chunk than the one it was
written for. Rank 1 in its own reading:

| Row   | Case                                  | Carrier (its sentence)                             | Question rank | `pin1` appended instead (q-rank) |
| ----- | ------------------------------------- | -------------------------------------------------- | ------------- | -------------------------------- |
| 1     | `ccss-pedir-prescripcion-cuotas`      | `ccss-prescripcion` «¿Una vez recibida…?» (s2)     | 12            | the carrier ✓                    |
| 3     | `ccss-obligacion-ingreso-bajo`        | `ccss-faq` «¿Dónde me corresponde realizar…?» (s1) | 34            | `ccss-reglamento-ti` 10 (9)      |
| 4     | `desinscripcion-dejar-actividad`      | `ley-iva` 27 (s4) · `cnpt` 79 (s2)                 | 24 · 40       | Declaraciones del RUT · 43 (19)  |
| 6     | `ho-hacienda-solo-cliente-eeuu`       | `cnpt` 78 (s3)                                     | 31            | RUT · 1 (27)                     |
| 7     | `ho-trabajitos-por-mi-cuenta`         | RUT · 1 (s1) · Declaraciones del RUT · 2 (s4)      | 18 · 23       | `ccss-reglamento-ti` 1 (17)      |
| 9     | `ho-donde-me-afilio-caja`             | `ccss-faq` «¿Cuándo me corresponde pagar…?» (s2)   | 37            | `ccss-reglamento-ti` 10 (23)     |
| 11–12 | `ho-factura-electronica-o-recibo`     | `reglamento-comprobantes` 22 (s4)                  | 29            | `reglamento-comprobantes` 4 (10) |
| 18    | `ho-rebajar-25-sin-facturas`          | `tribu-cr-res-0011-2025` 2 (s3)                    | 40            | `ley-renta` 22 (27)              |
| 23–25 | `ho-ademas-tengo-salario`             | `ley-renta` 22 (s2)                                | 34            | `ley-renta` 8 #2 (29)            |
| 27    | `desinscribir-debiendo-declaraciones` | `cnpt` 79 (s2)                                     | 35            | `ley-iva` 27 (11)                |

Row 11's other carrier, `reglamento-comprobantes` 16, is no sentence's pick
(rank 7 in s1 and s4). The catalogue does not list it, and Art. 22 carries
the row.

The step that is missing is the one the question did not ask, so it ranks
low against the question. That makes it the pick `pin1` ranks last (#460).
Row 1 was lost in Wave D's lane and wins here, by question rank 12 against
14 and 16.

## The lever: more than one fresh pick

Counterfactual on the same read ([`pin-n.mjs`](pin-n.mjs), free): the cut
plus the best N fresh picks by question rank, as `answerSetFromOrder` orders
them.

| Appended picks | Rows whose carrier reaches the set                        |
| -------------- | --------------------------------------------------------- |
| 1 (`pin1`)     | 1                                                         |
| 2              | 1, 6, 7, 9, 11, 12, 23, 24, 25; row 4's `ley-iva` 27 half |
| 3              | all but 27                                                |
| all (`pin`)    | all                                                       |

The read's cost: Haiku 5.5 wrote 10 expansions. There were about 60 embeds and 61
Voyage rerank readings over 40 chunks each. Scaled from the
`answer-set-probe`'s ≈US$0.15 for about 116 cases, that is ≈US$0.02.

## The fix and its probe

`STEP_PINS` (rerank.ts, default 2): `pin1` appends the best `STEP_PINS`
fresh picks in #460's order instead of one. `STEP_PINS=1` is the pre-#561
code path. Both arms are `pnpm answer-set-probe` on every case, from this
worktree on 941e8f5, with `ANSWER_EFFORT=low` exported:

- **before**: `STEP_PINS=1`, live rewrites. Files:
  [`probe-before.json`](probe-before.json) and
  [`probe-before-20261009T014720Z.log`](probe-before-20261009T014720Z.log).
- **after**: `STEP_PINS=2`, `EVAL_REWRITES=probe-before.json`,
  `PROBE_CASE_MS=3000`. Files: [`probe-after.json`](probe-after.json) and
  [`probe-after-20261009T015258Z.log`](probe-after-20261009T015258Z.log).
  The log is cut short after the cross-reference list. It was piped through
  `head`, which closed `tee`. The JSON is written before the log is printed,
  and it holds all 116 cases.

Neither arm lost a rerank reading (598 of 598 each). The per-case read is
[`compare.mjs`](compare.mjs), free, on the production configuration
(`top8/capoff/pinon`):

| Production configuration    | before  | after   |
| --------------------------- | ------- | ------- |
| Expected targets in the set | 143/193 | 149/193 |
| Tier 1 targets in the set   | 63/93   | 69/93   |
| Cases holding every target  | 48/74   | 49/74   |
| Hit-rate cases              | 72/74   | 72/74   |
| Robustness block hits       | 27/27   | 27/27   |

**#561's carriers in the set.** Rows 1 and 3 are in on both arms. Six more come
in on the after arm: 4 (the `ley-iva` 27 half), 6, 7, 9, 11 and 12. Rows 4
(`cnpt` 79), 18, 23–25 and 27 stay out. Their carrier ranks third or lower
among the fresh picks against the question. On this draw `ho-ademas-tengo-salario`'s
second place went to `reglamento-renta` 28, not `ley-renta` 22.

**Nothing leaves.** No case loses an expected target, and no hit changes.
Two answer sets lose a chunk, and neither is the change.
`rb-spanglish-invoice` classifies to no family, so `STEP_PINS` never reads
it. Its question order put the Preámbulo and Art. 1 in swapped places at
#8/#9. On `ho-abs-devs-exentos-renta` the question's own order moved
`ley-renta` 28 bis from #6 to #9. Nine cases' reranked top 8 differ between
the arms. That is Voyage and the embedder run to run, which #457 measured.
The appends themselves only add.

**Set size**, before → after, in cases:

| Sets                           | Cases |
| ------------------------------ | ----- |
| 10 → 11                        | 69    |
| 9 → 10                         | 8     |
| 11 → 12                        | 8     |
| 12 → 13                        | 1     |
| unchanged, classified (10, 11) | 2     |
| unchanged, no family (8, 9)    | 28    |

86 of 116 sets grow by exactly one fragment. Every one of them classified to
a family and had a second fresh pick. The typical classified ask goes from 10
fragments to 11: the cut, one step pick and a cross-reference or a
derived-figure pin, plus now a second step pick. 8 asks go from 9 to 10.

**The risk this can't read.** Groundedness and adequacy need the answer
model. `pin` (every pick, 10–11 fragments) cost groundedness in #311's arm
(2026-09-24, before Sonnet 5.5). The wave's final full lane is the check.

Cost: both arms ≈US$0.15 each, by the probe's usual figure. The before arm
ran 116 Haiku rewrites (expansions and 15 condensations), and both ran 598
Voyage rerank readings. Total for #561 with the step-pick read: ≈US$0.32.
