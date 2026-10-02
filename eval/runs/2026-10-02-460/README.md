# `pin1` ranked by the question, 2026-10-02 (#460)

The evidence for #460: three `pnpm answer-set-probe` runs on the local stack
carrying the 873-chunk ingest, no answer model and no judge. The retrieval
knobs were set on the command line to their production values
(`STEPS=on STEPS_RERANK=pin1 EXPAND=on RERANK=voyage EMBEDDINGS_PROVIDER=voyage`,
with `RERANK_MODEL`, `EXPAND_MODEL` and `CONDENSE_MODEL` empty), so the
symlinked `.env.local` could not move any run. Owner-approved through the
coordinator; about US$0.45 in all, by estimate. The figures below are the production
configuration, `top8/capoff/pinon`.

**The change did not ship.** It is kept, unmerged, on the branch
`rjwrld/460-pin1-question-rank-code` (c7ac955). The owner's bar was that the
Tier 1 targets in the answer sets rise and none is lost: they rise, 58 → 61
of 93, but three are lost.

| File                                             | What it is                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe-baseline.log` · `probe-baseline.json`     | `main`'s probe, run from the main checkout at 567afb3 with live rewrites. Its JSON is the `EVAL_REWRITES` file of both branch runs, so all three read every case on the same query and expansion.                                                                                                 |
| `probe-branch.log` · `probe-branch.json`         | The branch's probe at c7ac955, paced with `PROBE_CASE_MS=3000` (≈21 cases/min). No rerank reading lost. **The comparison below is this run against the baseline.**                                                                                                                                |
| `probe-branch-429.log` · `probe-branch-429.json` | The branch's first probe, on the rank rule alone (no derived-pin skip), unpaced. Voyage returned 429 on 77 of 406 rerank readings, on 23 cases. Kept for the pacing finding and for the `multa-iva-no-declarado` loss that led to the derived-pin skip; its other per-case rows are not evidence. |

The logs' path to the worktree is replaced with `<worktree>`, and the JSONs
are re-indented by `prettier`. Nothing else is edited.

## What the branch changed

1. `answerSetFromOrder` (`src/lib/answer/rerank.ts`): under `pin1`, of the
   step picks the cut did not take, the one appended is the one the
   question's reading ranks best (`RerankedChunk.rank`). The sentence's score
   breaks a tie, then sentence order. Before, it was the best score against
   the pick's own sentence, which #460 found close to a constant per family.
2. In the same place, `pin1` skips a pick that `pinDerivedFigureInputs` will
   append to that cut anyway. On the unpaced run, `multa-iva-no-declarado`
   lost `cnpt` 88 (question rank #15) because the rank rule picked
   `salario-base-2026` (#14). The derived-figure pin was already adding that
   chunk, so the append was wasted.
3. `PROBE_CASE_MS` in `scripts/answer-set-probe.ts`: each case takes at least
   that long, so a replayed probe can be paced like a live one.

## What the paced run says

|              | Baseline | Branch    |
| ------------ | -------- | --------- |
| Tier 1       | 58/93    | **61/93** |
| Tier 2       | 77/98    | 78/98     |
| All targets  | 135/191  | 139/191   |
| Cases w/ all | 41/73    | 43/73     |

Six Tier 1 cases gain a target and three lose one:

- **Gains.** `ccss-ventana-prescripcion-24-meses` 2 → 3/3: `ccss-reglamento-ti`
  TRANSITORIO V (question rank #9) is the append, which is #456's
  acceptance. `ccss-pedir-prescripcion-cuotas` 0 → 1/3: «¿Una vez
  recibida…en cuanto tiempo resuelve…?» (#9). #460 asked for more than 1 of
  3, which one append cannot give from 0. `desinscripcion-dejar-actividad`
  4 → 5/9 (`ley-iva` 27, #36), `ho-trabajitos-por-mi-cuenta` 0 → 1/4
  (`ccss-reglamento-ti` 1, #9), `ho-donde-me-afilio-caja` 1 → 2/2 (`ccss-faq`
  «¿Cuándo me corresponde pagar…?», #38), `ho-cliente-espana-lleva-iva`
  1 → 2/5 (`reglamento-iva` 11, #19). On Tier 2, `factura-primera-cabys`
  1 → 2/2 (`cabys-dev`, #14).
- **Losses.** `ho-ademas-tengo-salario` 3 → 2/4 loses `ley-renta` ARTICULO 22
  (#32). `ho-desinscribir-debiendo-declaraciones` 2 → 1/5 loses `cnpt` 79
  (#36). `ho-iva-en-cero-sin-facturar` 3 → 2/3 loses `cnpt` 79 (#34), and its
  reranked order also moved, by embedding noise (#457). Each lost target was
  the old rule's family constant: T1-E pinned `ley-renta` 22 on every ask,
  and T1-H `cnpt` 79. On these three cases the constant happened to be a
  target, deep in the question's order. The question's reading ranks another
  pick above it.

The pin moved on 35 of the 64 asks that classify. The ranks are the
question's reading on the branch run:

| Case                                                                         | Tier  | Family | Baseline pick (rank)                                                     | Branch pick (rank)                                                       | Targets | Note                                                                    |
| ---------------------------------------------------------------------------- | ----- | ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------- | ----------------------------------------------------------------------- |
| `inscripcion-hacienda-clientes-extranjero`                                   | T2    | T1-A   | `cnpt` Artículo 78 (#26)                                                 | `tribu-cr-faq` Registro Único Tributario (RUT) · 1 (#21)                 | 4 → 4/4 |                                                                         |
| `ccss-cobro-retroactivo`                                                     | T2    | T1-G   | `ccss-prescripcion` ¿En qué momento puedo solicitar la prescripci… (#24) | `ccss-prescripcion` ¿Dónde presento la solicitud? (#13)                  | 2 → 2/2 |                                                                         |
| `ccss-pedir-prescripcion-cuotas`                                             | T1    | T1-G   | `ccss-prescripcion` ¿En qué momento puedo solicitar la prescripci… (#15) | `ccss-prescripcion` ¿Una vez recibida la solicitud de prescripció… (#9)  | 0 → 1/3 |                                                                         |
| `ccss-ventana-prescripcion-24-meses`                                         | T1    | T1-G   | `ccss-prescripcion` ¿En qué momento puedo solicitar la prescripci… (#23) | `ccss-reglamento-ti` TRANSITORIO V (#9)                                  | 2 → 3/3 |                                                                         |
| `ccss-obligacion-ingreso-bajo`                                               | T1    | T1-B   | `ccss-faq` ¿Dónde me corresponde realizar el trámite de … (#32)          | `ccss-faq` ¿Cuándo me corresponde pagar mi seguro de Tra… (#27)          | 2 → 2/4 |                                                                         |
| `ccss-asalariado-y-freelance`                                                | T2    | T1-E   | `ley-renta` ARTICULO 22 (#31)                                            | `reglamento-renta` Artículo 28 (#27)                                     | 1 → 1/2 |                                                                         |
| `ccss-cese-actividad`                                                        | T1    | T1-H   | `cnpt` Artículo 79 (#40)                                                 | `tribu-cr-faq` Declaraciones del RUT · 43 (#32)                          | 1 → 1/2 |                                                                         |
| `desinscripcion-dejar-actividad`                                             | T1    | T1-H   | `cnpt` Artículo 79 (#40)                                                 | `ley-iva` Artículo 27 (#36)                                              | 4 → 5/9 |                                                                         |
| `renta-persona-fisica-deduccion`                                             | T2    | T1-E   | `ley-renta` ARTICULO 22 (#33)                                            | `ley-renta` ARTICULO 8 (#11)                                             | 4 → 4/4 |                                                                         |
| `iva-servicios-extranjero-comprados`                                         | T2    | T1-D   | `ley-iva` Artículo 27 (#23)                                              | `reglamento-iva` Artículo 11 (#22)                                       | 2 → 2/3 |                                                                         |
| `iva-declaracion-mensual`                                                    | T2    | T1-D   | `cnpt` Artículo 79 (#36)                                                 | `reglamento-iva` Artículo 11 (#31)                                       | 2 → 2/2 | order moved (embedding noise)                                           |
| `iva-tarifa-general`                                                         | T2    | T1-D   | `ley-iva` Artículo 27 (#37)                                              | `reglamento-iva` Artículo 11 (#23)                                       | 1 → 1/1 |                                                                         |
| `iva-tarifas-reducidas`                                                      | T2    | T1-D   | `ley-iva` Artículo 27 (#33)                                              | `reglamento-iva` Artículo 11 (#20)                                       | 1 → 1/1 |                                                                         |
| `renta-bruta-que-incluye`                                                    | T2    | T1-E   | `ley-renta` ARTICULO 22 (#38)                                            | `ley-renta` ARTICULO 8 (#24)                                             | 2 → 2/2 |                                                                         |
| `renta-tramos-2026`                                                          | T2    | T1-E   | `ley-renta` ARTICULO 22 (#25)                                            | `ley-renta` ARTICULO 8 (#16)                                             | 2 → 2/2 |                                                                         |
| `renta-salario-y-actividad`                                                  | T2    | T1-E   | `ley-renta` ARTICULO 22 (#24)                                            | `reglamento-renta` Artículo 28 (#14)                                     | 3 → 3/5 |                                                                         |
| `iva-facturas-en-dolares`                                                    | T2    | T1-D   | `ley-iva` Artículo 27 (#28)                                              | `reglamento-iva` Artículo 11 (#21)                                       | 1 → 1/1 |                                                                         |
| `iva-retencion-tarjetas-porcentaje`                                          | T2    | T1-F   | `ccss-reglamento-ti` Artículo 12 (#34)                                   | `ccss-reglamento-ti` Artículo 10 (#33)                                   | 1 → 1/1 |                                                                         |
| `multa-iva-no-declarado`                                                     | T1    | T1-I   | `cnpt` Artículo 88 (#15)                                                 | `salario-base-2026` Circular 246-2025 (#14)                              | 3 → 3/5 | derived pin adds the new pick; with it on, the append goes to `cnpt` 88 |
| `factura-primera-cabys`                                                      | T2    | T1-C   | `reglamento-comprobantes` Artículo 9 (#15)                               | `cabys-dev` * (#14)                                                      | 1 → 2/2 |                                                                         |
| `ho-trabajitos-por-mi-cuenta`                                                | T1    | T1-A   | `cnpt` Artículo 78 (#33)                                                 | `ccss-reglamento-ti` Artículo 1 (#9)                                     | 0 → 1/4 |                                                                         |
| `ho-desde-cuanta-plata-caja`                                                 | T1    | T1-B   | `ccss-faq` ¿Dónde me corresponde realizar el trámite de … (#27)          | `ccss-reglamento-ti` Artículo 10 (#10)                                   | 4 → 4/4 |                                                                         |
| `ho-donde-me-afilio-caja`                                                    | T1    | T1-B   | `salarios-minimos` Artículo 1 (#40)                                      | `ccss-faq` ¿Cuándo me corresponde pagar mi seguro de Tra… (#38)          | 1 → 2/2 |                                                                         |
| `ho-cliente-espana-lleva-iva`                                                | T1    | T1-D   | `ley-iva` Artículo 27 (#28)                                              | `reglamento-iva` Artículo 11 (#19)                                       | 1 → 2/5 |                                                                         |
| `ho-iva-en-cero-sin-facturar`                                                | T1    | T1-D   | `cnpt` Artículo 79 (#34)                                                 | `reglamento-iva` Artículo 11 (#24)                                       | 3 → 2/3 | order moved (embedding noise)                                           |
| `ho-ademas-tengo-salario`                                                    | T1    | T1-E   | `ley-renta` ARTICULO 22 (#32)                                            | `ley-renta` ARTICULO 8 (#27)                                             | 3 → 2/4 |                                                                         |
| `ho-minimo-caja-independiente-2026`                                          | T1    | T1-F   | `ccss-reglamento-ti` Artículo 12 (#14)                                   | `ccss-reglamento-ti` Artículo 10 (#10)                                   | 3 → 3/3 |                                                                         |
| `ho-800-mil-que-porcentaje-caja`                                             | T1    | T1-F   | `ccss-reglamento-ti` Artículo 12 (#12)                                   | `ccss-reglamento-ti` Artículo 10 (#9)                                    | 3 → 3/3 |                                                                         |
| `ho-cobrar-8-anos-atras-caja`                                                | T1    | T1-G   | `ccss-prescripcion` ¿En qué momento puedo solicitar la prescripci… (#25) | `ccss-prescripcion` ¿Una vez recibida la solicitud de prescripció… (#10) | 2 → 2/2 |                                                                         |
| `ho-desinscribir-debiendo-declaraciones`                                     | T1    | T1-H   | `cnpt` Artículo 79 (#36)                                                 | `ley-iva` Artículo 27 (#11)                                              | 2 → 1/5 |                                                                         |
| `ho-rebajar-multa-si-pago-ya`                                                | T1    | T1-I   | `salario-base-2026` Circular 246-2025 (#40)                              | `cnpt` Artículo 78 (#10)                                                 | 2 → 2/2 |                                                                         |
| `ho-t2-hosting-extranjero`                                                   | T2    | T1-D   | `ley-iva` Artículo 27 (#20)                                              | `reglamento-iva` Artículo 11 (#18)                                       | 2 → 2/3 |                                                                         |
| `ho-t2-salir-del-pais-seguro`                                                | T2    | T1-H   | `cnpt` Artículo 79 (#40)                                                 | `ccss-faq` ¿Qué debo hacer si dejo de trabajar de forma … (#15)          | 2 → 2/2 |                                                                         |
| `ho-abs-devs-exentos-renta`                                                  | abst. | T1-E   | `ley-renta` ARTICULO 22 (#37)                                            | `reglamento-renta` Artículo 28 (#28)                                     | 0 → 0/0 |                                                                         |
| `ho-abs-calculo-personalizado`                                               | abst. | T1-E   | `tribu-cr-res-0011-2025` Artículo 2 (#38)                                | `ley-renta` ARTICULO 8 (#25)                                             | 0 → 0/0 |                                                                         |
| The picks come from the `top8/capoff/pinoff` answer sets, where the one item |
| past the cut is `pin1`'s. The targets column is `top8/capoff/pinon`.         |

## Voyage 429s are the probe's pace, not load from elsewhere

The unpaced branch run lost 77 of 406 rerank readings to HTTP 429. The
baseline lost none. Both ran while no other paid run was on the key. The
difference is pace. The baseline asks Haiku for every expansion, which spaces
cases to 21.7 per minute. A replayed run asks no small model and ran 57.6 per
minute. That matches #457's reading: no loss at 21 cases/min, 60 calls lost at
54/min. With `PROBE_CASE_MS=3000` the paced run read all 406. Any frozen
probe or lane that wants a clean comparison needs pacing. The knob is on the
kept code branch, not on `main`.
