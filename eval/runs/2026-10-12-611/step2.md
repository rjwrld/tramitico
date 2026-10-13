# Step 2: the width sweep, 2026-10-13 (#611)

Two arms, `STEP_PINS=3` ([`pins3/`](pins3/)) and `STEP_PINS=5`
([`pins5/`](pins5/)), five live draws each, run with the owner's OK after
Amendment 1. The code and setup are the control's (main 1da0897,
`PROBE_CASE_MS=3000`, `ANSWER_EFFORT=low`), and only the knob differs. Each
arm's smoke read `rewrites: live`. Its largest `step` pin count was 3 for
`pins3` and 4 for `pins5`, against the control's 2, so the knob took. Every
draw exited 0.

`bars.ts` reads each arm against the control on R1–R4, with R3 as amended.
Its output is in `pins3/bars.log` and `pins5/bars.log`, and
`control/bars.log` holds the control read against itself.

```sh
pnpm exec tsx eval/runs/2026-10-12-611/bars.ts eval/runs/2026-10-12-611/pins3
pnpm exec tsx eval/runs/2026-10-12-611/bars.ts eval/runs/2026-10-12-611/pins5
```

## Result: neither arm passes R1–R4

| Bar | Control                                                 | `STEP_PINS=3`                                                     | `STEP_PINS=5`                                                                                 |
| --- | ------------------------------------------------------- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| R1  | 53.1 %                                                  | **FAIL** 60.9 % (needs ≥ 63.1 %); no floor row below 3/5          | **PASS** 63.3 %; no floor row below 3/5                                                       |
| R2  | step-pinned 7/27, Jaccard 0.67                          | **FAIL** step-pinned 12/27 (44.4 %); Jaccard 0.71                 | **FAIL** step-pinned 13/27 (48.1 %); Jaccard 0.71                                             |
| R3  | hit-rate 71–73/74; robustness 130/135; all-targets 49.2 | **PASS** hit-rate 70–71/74; robustness 26 27 26 27 27 = 133; 50.2 | **FAIL** hit-rate 69/74 = 93.2 % on draw 2; robustness 26 27 27 27 26 = 133; all-targets 49.2 |
| R4  | median size 11                                          | **PASS** 12                                                       | **PASS** 13, exactly the limit                                                                |

No case's `isWeak` flips in either arm or differs from the control.
`pins5`'s draw 5 lost two rerank readings, both to Voyage timeouts
(`iva-declaracion-mensual`: expansion; `ho-tambien-asegurado-por-patrono`:
step). Those two cases are excluded from that draw, so its hit-rate reads
68/72.

## Reading

- **Recall moves as expected.** The P-class rows the issue named go from
  2/5 to 5/5 at both widths: `ho-ademas-tengo-salario`'s three `ley-renta` 22
  rows, `ho-iva-en-cero-sin-facturar` (both rows),
  `desinscripcion-dejar-actividad` row 4 and `ho-hacienda-solo-cliente-eeuu`
  row 6. `ho-desinscribir-debiendo-declaraciones`'s `cnpt` 79 (class R)
  needs width 5: it goes 0 → 1 → 5.
- **`pins5`'s R3 fail is not the knob's doing.** Its draw 2 missed five
  gated cases. Two of them, `tribu-cr-declarar-pagar` and `ho-t2-payoneer`,
  classify to no family, so no step pin can touch them. The step picks are
  appended after the reranked top 8, which `STEP_PINS` doesn't read
  (`cutWithSteps`), so a wider pin can't push a target out of the cut. The
  three rows that fall with width (15, 30, 41) are cut members that drop out
  on some draws. That is draw noise, not an append.
- **R2's step-pinned measure counts more than pin stability.** A pick that
  lands inside the top 8 is labelled `top`, not `step`, so the subset changes
  whenever the cut takes or drops a pick, even when the picks themselves don't
  change. `reach-stability.mjs` reads the catalogue-reached chunks in the set
  instead: they are identical on every draw for 7/27 cases in the control,
  16/27 at width 3 and 22/27 at width 5. The step-pinned subset reads 7, 12
  and 13. That read is approximate, since `reaches` stand in for the picks,
  which the probe doesn't record.
- **Fix 1 at width 5 is nearly a no-op.** At width 5 every fresh pick is
  pinned, so ranking them by the question's own score doesn't change which
  ones go in. Fix 1 decides the set only where the slots are fewer than the
  fresh picks: at width 2 (production) and width 3.

## Cost

No log prints a cost. The estimate: 6,307 rerank readings at ≈US$0.0004
(≈US$2.52), plus ≈1,310 Haiku 5.5 rewrites (≈US$0.40), plus embeddings
(≈US$0). That is **≈US$2.95** for both arms with their smokes. Steps 1–2
together come to ≈US$4.40 of the US$12 cap for steps 1–5.
