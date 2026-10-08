# The total-loss rerank fallback, step legs in or out, 2026-10-07 (#510)

When every rerank reading is lost, `rerankReadings` returns `null` and the
answer set is the top 8 of the fused pool. Its order counts the step
catalogue's two legs (#304) at the same weight as the question's and the
expansion's. #510 asked whether a fallback that fuses only the question's and
the expansion's legs carries more Tier 1 targets. **It carries fewer. The
fused order stays.**

Both arms ran `pnpm answer-set-probe` under `RERANK=off`, the switch that takes
the same fallback path as a total loss. They ran on this branch on the shared
local stack carrying the 873-chunk ingest, with `STEPS=on STEPS_RERANK=pin1`
exported. Both replayed the queries and expansions #502's Haiku 5.5 arm wrote
(`EVAL_REWRITES=eval/runs/2026-10-07-502-robustness/probe-haiku-5-5.json`), so
both arms cut identical pools and no small model was asked. Pacing was
`PROBE_CASE_MS=1000`. No provider call failed in any run.

| File                  | What it is                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `smoke-current*`      | Arm 1's smoke: `EVAL_CASES=ccss-cuanto-pago-base,rb-pill-cuanto-pago-independiente,rb-seguimiento-cuanto-me-toca` |
| `probe-current*`      | Arm 1: the fallback of record, the fused order                                                                    |
| `probe-step-free*`    | Arm 2: the pool re-sorted with the step legs taken out (below)                                                    |
| `step-free-arm.patch` | The uncommitted edit arm 2 ran on, against this branch's `rerank.ts`                                              |
| `pools-legs.json`     | Every retrieval case's pool with its fused score and six leg ranks, for the offline reads                         |
| `dump-pools.patch`    | The throwaway script that wrote `pools-legs.json`, on the same replayed rewrites                                  |
| `offline-reads.mjs`   | The offline table below, free: `node offline-reads.mjs pools-legs.json`                                           |

## What arm 2 ran

`search_chunks` returns each chunk's fused score and its rank in each leg, but
not the coverage that scales an OR-fallback lexical leg's contribution
(migration `20260907120000`). So the exact step-free sum cannot be rebuilt in
TypeScript. Arm 2 subtracts the step legs' full share from the score:

    score − 1/(60 + step_vector_rank) − 1/(60 + step_lexical_rank)

That is exact when the step lexical match had full coverage, and demotes the
chunk a little further otherwise. The offline reads below bracket the exact
sum, and every variant that keeps the coverage loses Tier 1 targets.

## Readings

Route configuration, `top8/capoff/pinon`, outside the robustness block:

| Fallback order              | Tier 1 targets | Tier 1 cases with all | Tier 2 targets | Cases hit |
| --------------------------- | -------------- | --------------------- | -------------- | --------- |
| Fused (current, arm 1)      | **57/93**      | 12/27                 | 61/98          | 63/73     |
| Step legs taken out (arm 2) | 47/93          | 9/27                  | 62/98          | 65/73     |

- **Tier 1 loses 16 targets and gains 6**, net −10. The cases that lose net
  are the step chunks the catalogue exists to carry:
  `inscripcion-tardia-sancion` 3 → 0, `ccss-pedir-prescripcion-cuotas` 3 → 1,
  `ho-tiquete-en-vez-de-factura` 3 → 1, and one each on
  `ccss-cese-actividad`, `multa-iva-no-declarado`,
  `ho-cliente-espana-lleva-iva`, `ho-iva-en-cero-sin-facturar` and
  `ho-tambien-asegurado-por-patrono`. The cases that gain net take
  `tramos-renta-2026` (`ho-minimo-renta-2026`, `ho-ademas-tengo-salario`).
  Three more swap one target for another: `desinscripcion-dejar-actividad`,
  `ho-trabajitos-por-mi-cuenta`, `ho-desinscribir-debiendo-declaraciones`.
- **Why the step legs matter here.** On a total loss there are no step picks:
  `pin1`'s pick comes from the step sentences' rerank readings, which were
  lost with the rest. The fused order's step legs are then the only way a
  step chunk reaches the set.
- **Tier 2 moves the other way, by less.** Rate and article targets the step
  chunks had crowded out come back (`ley-iva` 15, `tramos-renta-2026`,
  `reglamento-iva-bienes-capital` 31, `ley-renta` 5), and step targets go
  (`tribu-cr-faq` RUT on `inscripcion-tribu-cr`, `reglamento-renta` 57,
  `cabys-dev`).
- **The robustness block** hits 21/27 on the fused order and 19/27 step-free.
  Its Tier 1 cases lose 9 targets and gain 3: `rb-pill-me-salgo` 3 → 1,
  `rb-pill-inscribi-tarde` 3 → 0, `rb-tilde-deje-de-trabajr` 2 → 0,
  `rb-tilde-asegurarme-poquito` 2 → 3, and `rb-pill-asegurarme-gano-poco`
  swaps one.
- **#490 item 1 is not this.** «¿Cuánto pago como independiente?»
  (`rb-pill-cuanto-pago-independiente`) misses all 4 targets on both orders.
  On the fused order its eight places are all step-leg chunks
  (`ccss-reglamento-ti` 10, 12, 6, 1, its preámbulo and three `ccss-faq`
  entries). Taking the step legs out puts `ccss-prescripcion` entries in
  their place, not the escalas. That case needs the rerank or #509, not a
  different fallback.

## Offline: the same pools, other step-free sums

From `pools-legs.json`, top 8 with no cap and no derived-figure pin
(`top8/capoff/pinoff`). The fused row reproduces arm 1's 108/191 for that
configuration exactly.

| Order                                                         | Targets | Tier 1    | Cases hit |
| ------------------------------------------------------------- | ------- | --------- | --------- |
| Fused, as returned                                            | 108/191 | **49/93** | 63/73     |
| Step legs' full share subtracted (arm 2)                      | 101/191 | 40/93     | 65/73     |
| Step vector share only subtracted (each score an upper bound) | 99/191  | 42/93     | 60/73     |
| Step share apportioned by the lexical legs' common coverage   | 98/191  | 39/93     | 64/73     |
| Plain RRF over the four ranks, no coverage scaling            | 82/191  | 31/93     | 57/73     |

Chunk by chunk, the exact step-free sum lies between the second and third
rows' scores. The three variants that keep the coverage cost 7–10 Tier 1
targets before the pin, and dropping the coverage as well costs 18.

## Cost

Voyage `voyage-3` embeddings only: the question, the expansion and the step
sentences, for 3 + 109 + 109 cases and a 100-case leg dump. No Anthropic call
and no rerank call. Well under US$0.01. No console figure was read.
