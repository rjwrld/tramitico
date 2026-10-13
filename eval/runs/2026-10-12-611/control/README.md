# Step 1: the control, 2026-10-13 (#611)

Five live `answer-set-probe` draws on main 1da0897, with the owner's OK. The
worktree's pipeline code equaled `origin/main`. `PROBE_CASE_MS=3000`,
`ANSWER_EFFORT=low`, and `EVAL_REWRITES`, `EVAL_CASES` and `STEP_PINS` were
unset. The commands are the ones in [`../README.md`](../README.md), with one
change: each draw's output went to its log with `>` rather than `tee`, and
`timing.log` records the start, end and exit of each draw.

| File                                     | What it is                                                                         |
| ---------------------------------------- | ---------------------------------------------------------------------------------- |
| `smoke.json` · `smoke.log`               | The 3-case smoke: `rewrites: live`, no failed provider call, 0 of 20 readings lost |
| `probe-{1..5}.json` · `probe-{1..5}.log` | The five draws, 116 cases each (101 retrieval, 15 abstention)                      |
| `timing.log`                             | 06:16–06:47 UTC, about 6 min a draw, every exit 0                                  |
| `carrier-recall.log`                     | `pnpm carrier-recall ../carriers.json probe-{1..5}.json`, free                     |

The probe writes no transcript, so nothing went to `eval/transcripts/`. The
logs' absolute paths were made relative to the repository.

## The draws

Every draw read `rewrites: live`. None lost a rerank reading (625, 624, 632,
629 and 629 asked), so no case was excluded. Three draws had two expansion
timeouts each, which the probe records and production does too:

- draw 1: `iva-retencion-tarjetas-porcentaje`, `ho-tiquete-en-vez-de-factura`
- draw 2: `rb-pill-inscribo-exterior`, `rb-pill-inscribi-tarde`
- draw 5: `ho-hasta-que-dia-tengo-iva`, `rb-pill-inscribo-exterior`

The preregistration excludes only lost readings, so these cases stay in.

| Draw | Hit-rate     | Robustness | All targets | Weak | Median size |
| ---- | ------------ | ---------- | ----------- | ---- | ----------- |
| 1    | 71/74 95.9 % | 26/27      | 48/74       | 0    | 11          |
| 2    | 71/74 95.9 % | 25/27      | 50/74       | 0    | 11          |
| 3    | 73/74 98.6 % | 26/27      | 48/74       | 0    | 11          |
| 4    | 72/74 97.3 % | **27/27**  | 50/74       | 0    | 11          |
| 5    | 72/74 97.3 % | 26/27      | 50/74       | 0    | 11          |

- **Gated misses.** `ho-t2-credito-iva-compras` misses on 5/5 draws. Its
  targets (`ley-iva` 21 and 17) are in no pool on any draw, and `ley-iva` 11
  takes the cross-reference slot every time, as step 0's read found. The other
  misses are one-offs: `ccss-asalariado-followup` (draws 1 and 4), and
  `ho-t2-payoneer`, `ho-hacienda-solo-cliente-eeuu`, `ho-t2-hosting-extranjero`
  and `ho-t2-autorizar-contador` once each.
- **Robustness misses.** `rb-pill-retroactivo` once,
  `rb-tilde-inscribirme-afuera` twice and `rb-pill-inscribo-exterior` twice.
  Each time, the seed case hit. Both of `rb-pill-inscribo-exterior`'s misses
  are draws where its own expansion timed out.

## Carrier recall per case

Each case's rows are pooled over the five draws. The rows are in
`carrier-recall.log`.

| Case                                     | Rows | Carried (row, draw) pairs |
| ---------------------------------------- | ---: | ------------------------: |
| `ho-rebajar-25-sin-facturas`             |    1 |                 0/5 (0 %) |
| `ho-tambien-asegurado-por-patrono`       |    1 |                 0/5 (0 %) |
| `ho-800-mil-que-porcentaje-caja`         |    1 |                 0/5 (0 %) |
| `ho-donde-inscribo-ya-no-atv`            |    6 |                1/30 (3 %) |
| `ho-rebajar-multa-si-pago-ya`            |    2 |               1/10 (10 %) |
| `ho-iva-en-cero-sin-facturar`            |    2 |               2/10 (20 %) |
| `desinscripcion-dejar-actividad`         |    3 |               4/15 (27 %) |
| `ho-ademas-tengo-salario`                |    8 |              17/40 (42 %) |
| `ho-hacienda-solo-cliente-eeuu`          |    4 |              10/20 (50 %) |
| `ho-desde-cuanta-plata-caja`             |    2 |               5/10 (50 %) |
| `ho-minimo-renta-2026`                   |    4 |              10/20 (50 %) |
| `ho-desinscribir-debiendo-declaraciones` |    2 |               5/10 (50 %) |
| `ho-cabys-paginas-web`                   |    1 |                3/5 (60 %) |
| `ho-cliente-espana-lleva-iva`            |    7 |              23/35 (66 %) |
| `multa-iva-no-declarado`                 |    3 |              10/15 (67 %) |
| `ccss-pedir-prescripcion-cuotas`         |    4 |              16/20 (80 %) |
| `ho-hasta-que-dia-tengo-iva`             |    1 |                4/5 (80 %) |
| `ccss-obligacion-ingreso-bajo`           |    2 |               9/10 (90 %) |
| `inscripcion-tardia-sancion`             |    3 |             15/15 (100 %) |
| `ho-trabajitos-por-mi-cuenta`            |    1 |               5/5 (100 %) |
| `ho-donde-me-afilio-caja`                |    1 |               5/5 (100 %) |
| `ho-tiquete-en-vez-de-factura`           |    1 |               5/5 (100 %) |
| `ho-factura-electronica-o-recibo`        |    2 |             10/10 (100 %) |
| `ccss-cuanto-pago-base`                  |    2 |             10/10 (100 %) |

19 of the 64 rows are 0/5. They include the #609 retrieval misses
`ho-rebajar-25-sin-facturas` (RES-0020 Art. 3), `ho-tambien-asegurado-por-patrono`
(`ccss-reglamento-ti` 7), `ho-minimo-renta-2026`'s period
(`reglamento-renta` 12), `ho-desinscribir-debiendo-declaraciones`'s `cnpt` 79,
the ATV half, and `ho-donde-inscribo-ya-no-atv`'s OVi path (Declaraciones del
RUT · 3).

## Against the bars (preregistration.md)

The bars compare a candidate with this control, so the control sets their
reference values. Where a bar is absolute, this table also says whether the
control itself meets it.

| Bar | Control value                                                                                                                                                                                                                    | What a candidate must reach                                                                                        |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| R1  | **170/320 = 53.1 %** (requirement rows 90/170 = 52.9 %, lone carriers 80/150 = 53.3 %). 28 rows carried in ≥ 4/5 draws: 1, 2, 3, 5, 7, 9, 10, 11, 12, 14, 17, 19, 21, 22, 40, 41, 42, 44, 51, 52, 54, 55, 57, 58, 59, 60, 63, 64 | ≥ 63.1 %, and none of those 28 rows below 3/5                                                                      |
| R2  | Tier 1 median pairwise Jaccard **0.67** (all cases 0.64). Step-pinned subset identical on **7/27** classified Tier 1 cases (25.9 %), so the control **does not meet** the absolute 90 % bar                                      | Jaccard ≥ 0.67; step-pinned subset identical on ≥ 90 % (fix 3: Jaccard ≥ 0.77)                                     |
| R3  | Hit-rate ≥ 0.94 on every draw (95.9–98.6 %), **met**. Robustness 27/27 on **1 of 5** draws (26, 25, 26, 27, 26), **not met**. All-targets mean **49.2**. `isWeak`: no flips, 0 weak on every draw                                | hit-rate ≥ 0.94 and robustness 27/27 on every draw; all-targets mean ≥ 48.2; each case's `isWeak` the same as here |
| R4  | Median size **11** on every draw                                                                                                                                                                                                 | ≤ 13                                                                                                               |

**R3's robustness clause fails on the control's own noise.** The
preregistration asks for 27/27 on every draw, and the control reached it on 1
of 5. The lane's own gate is laxer (baseline 27, fails at ≤ 24), and every
control draw clears that. As written, R3 will very likely fail any candidate
for reasons that have nothing to do with it. The preregistration doesn't
change after a draw, so whether to read this clause as written is the owner's
call.

## Cost

No log prints a cost. The estimate: 3,139 rerank readings at ≈US$0.0004
(≈US$1.26), plus ≈655 Haiku 5.5 rewrites (580 expansions, 75
condensations; ≈US$0.20), plus embeddings (≈US$0). That is **≈US$1.45**,
including the smoke, against #611's ≈US$1.50.
