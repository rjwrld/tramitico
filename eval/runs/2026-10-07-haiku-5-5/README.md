# Condensation and expansion on Haiku 5.5, 2026-10-07 (#496)

The owner-approved paid check for #496. The runs used this branch at 687c233 on the
local stack carrying the 873-chunk ingest. Every lane logged the production
retrieval line: `rerank=voyage rerank-2.5-lite, pool 40 → top 8, expand=on,
steps=on(pin1), pin=on`. The Haiku 4.5 arms set
`CONDENSE_MODEL=EXPAND_MODEL=claude-haiku-4-5` on this branch. That is not
`main`'s exact request, because `main` also sends `temperature: 0`. Thinking
is disabled, which is Haiku 4.5's default anyway. The estimated cost is under
US$1 in all.

| File                             | What it is                                                                                                                                          |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke-*.log` · `smoke/`         | A 3-case groundedness subset at `ANSWER_EFFORT=low`, on the branch defaults. The subset gates fail by design (#303). This run is a transcript read. |
| `hitrate-haiku-4-5-r{1,2}-*.log` | The retrieval hit-rate lane on Haiku 4.5, run twice.                                                                                                |
| `hitrate-haiku-5-5-r{1,2}-*.log` | The same lane on Haiku 5.5 (the branch default), run twice. The runs were interleaved 4.5 → 5.5 → 4.5 → 5.5.                                        |
| `arms-driver.log`                | One summary line per lane.                                                                                                                          |

## Readings

**The request is accepted.** The API sent back no 400 and no `unusable` on either
model. Both follow-ups in the smoke run condensed into good standalone
questions, and all three answers were grounded.

| Arm    | Hit rate | Blocking gate                                      | Misses                                                                                               | Rewrite failures |
| ------ | -------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------- |
| 4.5 r1 | 71/73    | **red** (`ho-desinscribir-debiendo-declaraciones`) | `ccss-asalariado-followup`, `ho-desinscribir-debiendo-declaraciones`                                 | 0                |
| 4.5 r2 | 70/73    | green                                              | `iva-tarifa-general`, `ccss-asalariado-followup`, `ho-t2-payoneer`                                   | 0                |
| 5.5 r1 | 69/73    | green                                              | `ho-t2-credito-iva-compras`, `ho-t2-arreglo-pago-caja`, `ho-t2-autorizar-contador`, `ho-t2-payoneer` | 0                |
| 5.5 r2 | 69/73    | green                                              | `iva-tarifa-general`, `ccss-asalariado-followup`, `ho-t2-credito-iva-compras`, `ho-t2-payoneer`      | 1 timeout        |

- Haiku 5.5 averaged 69 and Haiku 4.5 averaged 70.5. Both pass the 92% gate,
  and the gap sits inside the lane's run-to-run spread. Six of 5.5's eight
  misses are `ho-t2-*` cases, against one of 4.5's five.
- `ho-t2-credito-iva-compras` missed on both 5.5 runs and on neither 4.5 run.
  It is the one case that moved in the same direction twice.
- 5.5 passed the blocking gate on both runs. 4.5 failed it once.
- Speed did not show: 5.5 hit the 3 s expansion timeout once in 146 calls,
  and 4.5 never did. Latency was not measured beyond that.
