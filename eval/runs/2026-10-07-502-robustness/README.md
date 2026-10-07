# The robustness block, read on both rewrite models, 2026-10-07 (#502)

The owner-approved paid read for #502: `pnpm answer-set-probe` (retrieve →
rerank → cap → pin, no answer model, no judge) over the whole dataset with the
27-case robustness block in it, once per rewrite model. The runs used this
branch on the shared local stack carrying the 873-chunk ingest, with
`RERANK=voyage STEPS=on STEPS_RERANK=pin1` exported, so every arm read
production's retrieval. The two full arms ran serially.

| File               | What it is                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `smoke-haiku-5-5*` | `EVAL_CASES=ccss-cuanto-pago-base,rb-pill-cuanto-pago-independiente,rb-seguimiento-cuanto-me-toca` |
| `probe-haiku-5-5*` | Arm 1: `CONDENSE_MODEL=EXPAND_MODEL=claude-haiku-5-5`, the default since #496                      |
| `probe-haiku-4-5*` | Arm 2: `CONDENSE_MODEL=EXPAND_MODEL=claude-haiku-4-5`                                              |

Every number below is under the route's configuration, `top8/capoff/pinon`. A
case **hits** when one of its `expected` targets is in the answer set: the
retrieval hit-rate lane's own metric.

## Readings

| Arm       | Hit rate, outside the block | Block | `ho-t2-*` | Tier 1 `coloquial` | Provider calls lost                                     |
| --------- | --------------------------- | ----- | --------- | ------------------ | ------------------------------------------------------- |
| Haiku 5.5 | 69/73                       | 24/27 | 9/12      | 9/9                | none                                                    |
| Haiku 4.5 | 71/73                       | 25/27 | 12/12     | 9/9                | 1 expansion timeout (`comprobantes-factura-vs-tiquete`) |

- **Misses outside the block.** 5.5: `iva-tarifa-general`,
  `ho-t2-credito-iva-compras`, `ho-t2-autorizar-contador`, `ho-t2-payoneer`.
  4.5: `iva-tarifa-general`, `ccss-asalariado-followup`.
- **Block misses.** Both arms: `rb-corto-cuanto-es-iva` (its seed
  `iva-tarifa-general` missed too) and `rb-corto-cuanto-pago-caja`, which is
  **weak** on both: «¿cuánto pago a la caja?» takes the honest decline
  without a model call, while its seed hits. 5.5 only:
  `rb-pill-retroactivo`, whose expansion turned «retroactivo» into
  arrears interest and ranked `ley-10363 · ARTÍCULO 2` 22nd (4.5: 3rd).
- **The seed-pill labels.** On 5.5, eight of nine hit their seed's
  `expected`; «¿Me pueden cobrar retroactivo?» misses. On 4.5 all nine hit.
  «¿Cuánto pago como independiente?» (#490 item 1) hits on both, with 3 of
  its seed's 4 targets in the set.
- **The colloquial signal from #496.** It held on a third pair of runs.
  Across #496's two runs and this one, Haiku 5.5 missed 4, 2 and 3 `ho-t2-*`
  cases, and Haiku 4.5 missed 0, 1 and 0. `ho-t2-credito-iva-compras` and
  `ho-t2-payoneer` missed on all three 5.5 runs.
- **Abstention.** On 4.5, `ho-abs-aguinaldo-freelancer` resolves both BMC
  figures in every pinned configuration; on 5.5, no abstention case does.

The estimated cost is about US$0.65 for the smoke and both arms. No console
figure was read.
