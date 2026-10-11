# Every amount in salarios base brings the salario base, 2026-10-10 (#591)

#579 (PR #590) made `PIN_SALARIO_BASE` append the salario base in force when
the cut states a **multa or sanción** in salarios base. Owner decision 4
(2026-10-10) widened it: any amount a set chunk states as a multiple or a
fraction of the salario base triggers it, so an exemption threshold or a tramo
can't repeat #579's false absence («no tengo el monto del salario base»). The
pin now also reports what it did in the ask event (`salarioBase`).

## The trigger

`statesAmountInSalariosBase` (`src/lib/answer/salario-base.ts`): a count or a
share right before «salario(s) base», in figures or words, bare or in
parentheses, then at most «de», «del» or «de un». «tres salarios base»,
«(117) salarios base», «1,000 (mil) salarios base», «medio salario base»,
«(50%) de un salario base», «(1,5) del salario base». The words «salario base»
with no count before them don't trigger it: «la denominación salario base»,
«el monto actualizado del salario base», «se entiende como salario base».
#579's sanción reading is kept as `statesSanctionInSalariosBase` for its
census and this comparison. Every chunk it matches, the new one matches too.

## Match list (free)

`match-list.sql` is one read-only `SELECT` on the shared local stack (run
through the supabase-local MCP), with both patterns in Postgres regex.
`match-list.tsv` is its result. `census.ts` runs the TypeScript detectors
themselves over the same 873 chunks (`census.log`). The two agree row for row.

26 chunks say «salario(s) base». #579 fired on 4, #591 fires on 24:

| Fires on           | Chunks                                                                                                                                                                                                                 |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| both (#579's four) | `cnpt` 78, 79, 81 #0; `ley-iva` 85 bis                                                                                                                                                                                 |
| #591 only (20)     | `cnpt` 81 #1; `ley-iva` 8, 11 bis, 13; `ley-renta` 13, 31 ter; `reglamento-iva` 11 #2, 11 #3, 31, 38 bis, 58, 64; `reglamento-iva-bienes-capital` 31; `reglamento-renta` 30 #0, #1, #2, 81, 107; `reglamento-rts` 2, 3 |
| neither (2)        | `reglamento-renta` 22 (a definition: «se entiende como salario base (\*) la contenida en…»); `salario-base-2026` itself                                                                                                |

## Which eval sets change (free)

`offline-check.ts` does what #579's did. It takes each case's route set
(`top8/capoff/pinon`) from `2026-10-09-562/probe-after.json`, the newest full
probe (116 cases). It removes the recorded appends to get back to the cut,
then re-pins the cut with today's `pinAnswerSet` against the local stack. No
provider call. Log: `offline-check.log`.

- **32 sets gain `salario-base-2026`. 25 of them gain it only because of
  #591**, and the other 7 are #579's. 6 more sets trigger and already hold
  the circular. No set loses a chunk.
- The 25: `inscripcion-hacienda-clientes-extranjero`, `iva-clientes-fuera-cr`,
  `cabys-desarrollo-software`, `ccss-asalariado-y-freelance`,
  `regimen-simplificado-programador`, `iva-tarifas-reducidas`,
  `renta-tramos-2026`, `renta-pagos-parciales-retenciones`,
  `renta-salario-y-actividad`, `exportacion-servicios-comprobante`,
  `iva-ajuste-bien-de-capital`, `iva-retencion-tarjetas-porcentaje`,
  `ho-cliente-espana-lleva-iva`, `ho-minimo-renta-2026`,
  `ho-ademas-tengo-salario`, `ho-t2-hosting-extranjero`,
  `ho-t2-retencion-tarjetas`, `ho-t2-compu-cara-iva`,
  `ho-t2-panaderia-simplificado`, `ho-t2-payoneer`, `rb-pill-iva-exterior`,
  `rb-corto-tramos-renta`, `rb-corto-que-cabys`, `rb-spanglish-client-usa`,
  and the abstention case `abs-patente-comercial`.
- The biggest carriers are `reglamento-renta` 30 (9 sets) and `ley-iva` 8 (6
  more, besides two of #579's). `reglamento-renta` 30 puts the tramos of
  cooperative excedentes, in salarios base, in the same artículo as pagos
  parciales and retenciones. `ley-iva` 8 puts the alquiler exemption in the
  same artículo as the export exemption. `ley-renta` 31 ter brings it to
  `ho-minimo-renta-2026` and `rb-corto-tramos-renta`, but its tramos are also
  the cooperatives', not the persona física's, which are in colones. So in
  most of the 25 the amount in salarios base isn't what the question asks
  about. It may be in `iva-ajuste-bien-de-capital` and `ho-t2-compu-cara-iva`
  (the fifteen salarios base for a bien de capital).

## Paid step

The orchestrator OK'd each command. Rewrites were replayed from
`2026-10-09-562/probe-after.json`, so Voyage was the only provider called.
`ANSWER_EFFORT=low` was set but unused, since a probe asks no answer model.

| Part                                                                                                                 | Files                                 | ≈US$ |
| -------------------------------------------------------------------------------------------------------------------- | ------------------------------------- | ---- |
| Smoke (2026-10-10): `answer-set-probe` on `iva-clientes-fuera-cr`, `renta-tramos-2026`, `iva-ajuste-bien-de-capital` | `probe-smoke.json`, `probe-smoke.log` | 0.01 |
| Full (2026-10-10): `answer-set-probe` on the 32 sets the offline check grows (`probe.log` names them)                | `probe.json`, `probe.log`             | 0.11 |

Both costs are scaled from #579's measured 0.03 for 52 rerank readings. The
smoke made 20 readings and the full probe 185, and neither lost any. Both ran
on the local stack's 873-chunk corpus, before #592's two TRIBU-CR
resolutions were ingested.

**Smoke.** The live sets match the offline re-pin. The route's configuration
and `/sboff` differ in exactly one chunk in all 3 cases, the appended
`salario-base-2026` (pin `salarioBase`), and no set loses a chunk. Expected
targets stay at 5/5, and derived figures stay at 0 (nothing these sets hold
reads the salario base). Apart from that pin, `iva-clientes-fuera-cr`'s live
set differs from #562's saved one in one reranked chunk (`ley-renta` 65 in,
`reglamento-iva` 10 out). That comes from the rerank and is the same with the
pin off.

**Full probe.** The live result matches the offline one, except for one case
the rerank moved:

- **31 of the 32 sets gain `salario-base-2026`** (route configuration vs
  `/sboff`), and no set loses a chunk. Expected targets stay at 49 → 49, and
  the robustness block stays at 7/7.
- **`iva-retencion-tarjetas-porcentaje` gains nothing live.** Its only
  trigger offline was `reglamento-renta` 30 #0, and this run's rerank left it
  out of the set (`ley-iva` 30 and 10 came in, `reglamento-renta` 30 #0 and
  `ley-renta` 3 went out), so the pin answers `not_triggered`. Five more sets
  differ from #562's saved ones by one or two reranked chunks, the same way
  with the pin off. In each of those five, the pin still triggers.
- **Derived figures.** 7 sets newly resolve a figure: the CNPT multas
  (`cnpt-articulo-78-multa-mensual-2026`, `-tope-2026`,
  `cnpt-articulo-79-multa-declaracion-2026`). All 7 are #579's cases. **None
  of the 24 sets that gain the page only because of #591 resolves a derived
  figure.** There the circular is context only.
- **`abs-patente-comercial`, the abstention case, gains the circular too**
  (pin `salarioBase`), and `reglamento-rts` 2's «50% de un salario base»
  triggers it. It resolves no figure (abs-figures `—`), so the leak check has
  nothing to flag. Its full set is `reglamento-rts` 2, `reglamento-renta` 1,
  two `tribu-cr-faq` entries (RUT · 14 and CIH vista OVi · 14), `ley-renta`
  15, 54, 2, `reglamento-renta` 17, then the appends: `ley-renta` 2 bis
  (cross-reference) and `salario-base-2026`. Whether an extra colones figure
  in a decline's context makes the model more likely to quote it can only be
  shown by an answer replay.

## Answer replay (owner decision, 2026-10-10)

The owner kept the wide trigger. Before merging, a scoped `answer-replay`
checks that the extra chunk doesn't pull the salario base into answers where
it doesn't belong. Every row is answered on a set the full probe recorded, so
the chunks are fixed, and #592's ingest can't move them.

**Input.** `replay-input.ts` writes `replay-input.jsonl`, 10 rows, in this
order:

| Row | Case                                | Set              | Why                                                                                           |
| --- | ----------------------------------- | ---------------- | --------------------------------------------------------------------------------------------- |
| 1–2 | `iva-ajuste-bien-de-capital`        | pin on, `/sboff` | the «quince salarios base» threshold: does the page help?                                     |
| 3–4 | `ho-t2-compu-cara-iva`              | pin on, `/sboff` | the same                                                                                      |
| 5   | `renta-tramos-2026`                 | pin on           | `reglamento-renta` 30 #1, the cooperatives' tramos in salarios base, beside a tramos question |
| 6   | `ho-t2-retencion-tarjetas`          | pin on           | `reglamento-renta` 30 #0–#2                                                                   |
| 7   | `renta-pagos-parciales-retenciones` | pin on           | `reglamento-renta` 30 #0                                                                      |
| 8   | `ho-minimo-renta-2026` (Tier 1)     | pin on           | `ley-renta` 31 ter beside «el mínimo exento»                                                  |
| 9   | `iva-clientes-fuera-cr`             | pin on           | `ley-iva` 8's alquiler exemption beside the export one                                        |
| 10  | `abs-patente-comercial`             | pin on           | abstention, triggered by `reglamento-rts` 2                                                   |

The «recorded» side that `answer-replay` prints is Wave E's lane row. It was
answered on Wave E's sets, not these. The abstention case has no groundedness
row, so its row is built from the dataset and its Wave E abstention answer.
`--dry-run` rebuilt all 10 prompts (free). `replay-check.ts` reads the
replayed transcript against the bar below (free).

Two of the recorded answers, written without the page, already show the gap
the page fills: `iva-ajuste-bien-de-capital` says «supera los quince salarios
base [2] … El monto vigente del salario base confírmelo con Hacienda», and so
does `ho-t2-retencion-tarjetas`, about the retention's «operaciones que no
excedan de un salario base».

**Cost against the cap.** At the documented ≈US$0.10 a row with both judges
(eval/README Quick reference, and #579's 3 rows for 0.30), the 10 rows come
to ≈US$1.00, over the US$0.45 cap. The first request is the four rows that
answer the owner's question, «where it doesn't belong»: rows 5, 8, 9 and 10,
≈US$0.40. The two bienes-de-capital pairs (rows 1–4, ≈US$0.40) wait for a
cap decision.

**Pass bar, fixed before running.** Every replayed row must meet all of it:

1. **No salario base where the question doesn't need it.** In rows 5, 7, 8
   and 9, the answer doesn't cite the salario base's marker, doesn't state
   ¢462.200 or any colones amount derived from it, and doesn't apply a
   salario-base threshold to the reader's own case. In row 6 the salario base
   may appear only tied to the retention's exclusion («operaciones que no
   excedan de un salario base»), which the recorded answer already names.
2. **No abstention leak.** Row 10 states no figure at all (`figureMentions`,
   strict form) and doesn't cite the salario base. Read by hand: it still
   declines and routes to the municipality, because `answer-replay` doesn't
   run the abstention judge.
3. **No groundedness or false-absence regression.** Every row is grounded
   `pass`, with 0 false absence claims (#500) and 0 citation-invariant
   violations. Rows 1 and 3 must be no worse than their controls, rows 2 and 4. Whether the page helps (rows 1 and 3 state the threshold in colones,
   15 × ¢462.200, where the controls say «confírmelo con Hacienda») is
   reported, not gated.

Any row that misses the bar is a fail for #591 as it stands. It goes back to
the orchestrator, and nothing gets tuned toward the bar. The owner is reviewing the noise finding
above first.

### Replay, rows 5, 8, 9, 10 (2026-10-10, the orchestrator's OK)

The run used `ANSWER_MODEL=claude-sonnet-5-5` and `ANSWER_EFFORT=low`. Files:
`replay-noise.log`, and the transcript in `replay/`, copied from
`<main>/eval/transcripts/2026-10-10-591/`. `replay-check.ts` printed
`replay-noise-check.log`, and `cost.ts` printed `replay-noise-cost.log`.

```
grounded, recorded → replayed: 4 → 4 of 4
false absence claims (#500), recorded → replayed: 0 → 0
citation invariant: 0 violation(s)
derived figures incompletely cited: 0
```

**Against the bar: all four rows pass.**

1. **No salario base where it isn't needed.** `renta-tramos-2026`,
   `ho-minimo-renta-2026` and `iva-clientes-fuera-cr` don't cite the salario
   base's marker [12], don't name the salario base, and don't state ¢462.200.
   Their figures are the persona física's tramos in colones and the rates.
2. **No abstention leak.** `abs-patente-comercial` states no figure at all.
   It declines («No encuentro base oficial sobre dónde se tramita la patente
   comercial…»), routes to the municipality (ifam.go.cr), and cites only two
   `tribu-cr-faq` entries about the OVi inscripción ([3], [8]). It doesn't
   cite the salario base, [10]. The abstention judge didn't run, since
   `answer-replay` doesn't run it, so this reading is by hand.
3. **No groundedness or false-absence regression.** All four rows are
   grounded `pass`, as their recorded rows were, with 0 false absence claims
   and 0 citation violations.

**Outside the bar.** `ho-minimo-renta-2026` (Tier 1) has adequacy `fail`
with 2 requirements missing: «Los tramos son anuales y se aplican sobre la
renta neta…» and «El período del impuesto va del 1 de enero al 31 de
diciembre». Its Wave E row, answered on Wave E's set, also failed adequacy,
with 1 missing (the period). The replayed answer doesn't mention the salario
base, so nothing ties the extra miss to the pin. This row has no control,
so it can't be separated from answer-to-answer variance.

**Cost.** The transcript records only the answer call's output tokens (385–1,163
a row). `cost.ts` estimates the inputs from characters, at 3 characters a
token, with no cache discount and assumed judge outputs. The prompts carry
10–12 chunks (≈14–19k input tokens each, for the answer and the groundedness
judge alike), which gives **≈US$0.11 a row, ≈US$0.44 for the four**. At 4
characters a token it is still ≈US$0.09 a row. That is above the ledger's
≈US$0.043 a row and above the US$0.06 a row the orchestrator set as the
condition for the bienes rows, so rows 1–4 were **not requested**. There's
no console figure, so the owner's Console usage for 2026-10-11 00:29 UTC is
the only exact reading.
