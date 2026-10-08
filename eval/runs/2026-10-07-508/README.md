# In-document cross-references, measured, 2026-10-07 (#508)

The paid reads for #508 (cap US$2.50, ADR 0024): `pnpm answer-set-probe` over the
whole dataset, then the two lanes that answer, scoped to the cases the change
moved. Branch `rjwrld/508-cross-reference` on the shared local stack carrying the
873-chunk ingest, production's knobs (`RERANK=voyage`, `STEPS=on`,
`STEPS_RERANK=pin1`, `PIN_DERIVED_INPUTS=on`, Haiku 5.5 rewrites, Sonnet 5.5 at
`ANSWER_EFFORT=low`).

| File                    | What it is                                                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke*`                | `EVAL_CASES=ho-abs-iva-2027,iva-tarifa-general,rb-corto-tasa-iva`, the first version (cap 2)                                                                                        |
| `probe-r1-cap2*`        | The full probe on the first version (cap 2, text order). **Not a reading**: 58 of 545 rerank readings were lost to Voyage 429s on 29 cases. Kept for its rewrites, which r2 replays |
| `probe.json`, `probe-*` | The reading: the shipped version (cap 1, a deferred figure first), `EVAL_REWRITES=probe-r1-cap2.json PROBE_CASE_MS=3000` — Voyage the only live provider, 0 of 545 readings lost    |
| `lanes/abstention*`     | The abstention lane. It does not read `EVAL_CASES`, so it ran all nine cases; `ho-abs-iva-2027` is the one #508 is about                                                            |
| `lanes/groundedness*`   | `EVAL_CASES=ho-cliente-espana-lleva-iva,iva-tarifas-reducidas`: the two IVA cases whose answer set gained art. 10. The gates refuse a subset, as designed; the rows are the read    |

## Readings

Under the route's configuration, `top8/capoff/pinon`, against the same reranked
orders with `PIN_CROSS_REFERENCES=off` (`top8/capoff/pinon/xrefoff`):

| Version                       | Answer sets grown | Chunks appended | Targets gained, outside the block | In the block | Tier 1           |
| ----------------------------- | ----------------- | --------------- | --------------------------------- | ------------ | ---------------- |
| cap 2, text order (r1 orders) | 80/109            | 151             | +3                                | +2           | +1               |
| cap 1, text order (r1 orders) | 80/109            | 80              | +3                                | +2           | +1               |
| **cap 1, figure first** (r2)  | **80/109**        | **80**          | **+3** (133 → 136 of 191)         | 0            | **+2** (62 → 64) |

The first two rows replay r1's recorded answer sets through each version
offline (the lookup reads the local corpus, free); the last is the probe itself.

- **The second slot bought nothing.** At cap 2 it filled on 71 sets, and no
  expected target came from it. Cap 1 keeps every gain at half the chunks.
- **A deferred figure first** trades two robustness-block and one Tier 2 gain
  for a second Tier 1 one: `ho-cliente-espana-lleva-iva` gains `ley-iva ·
Artículo 10` (the 13 % of its third requirement), and art. 30's «la tarifa
  referida en el artículo 10» picks art. 10 over the art. 4 it names first.
- **What is appended most:** `ley-iva · Artículo 10` (14 sets), `ley-iva ·
Artículo 4`, `ley-iva · Artículo 11`, `ley-renta · ARTICULO 2` (8 each).
- **Derived figures:** `inscripcion-tardia-sancion` and `rb-corto-multa-tarde`
  resolve a third CNPT figure (art. 79's multa por declaración), its input
  appended because `cnpt` art. 78 names it. No abstention case resolves a
  figure.
- **`ho-abs-iva-2027`:** its set gains `ley-iva · Artículo 10` in the probe and
  in the lane. The answer: «La tarifa general del impuesto es del 13% para todas
  las operaciones sujetas al pago del impuesto [10]», [10] being that chunk; the
  lane's requirement check (13 % and art. 10, cited, never denied) passes, and
  false absence claims are 0 of 9. The assertion stays a todo until #507.
- **The groundedness rows:** both grounded. `iva-tarifas-reducidas` opens on
  «La tarifa general del IVA es del 13% … [10]», the appended art. 10.
  `ho-cliente-espana-lleva-iva`'s live cut differed from the probe's: art. 30
  was in it (8th), but `reglamento-iva` art. 1 (6th) defers «tarifas» to art.
  11 first, so the one slot went to art. 11 and the answer did not state the
  13 %. It states 2 of its 6 Tier 1 requirements: one run, not a reading.
- **Abstention, all nine:** 7 pass. `ho-abs-calculo-personalizado` and
  `ho-abs-sociedad-inactiva` fail all three answers, on routing and on
  answering more than the decline. Neither set gained a chunk that bears on
  either (`ley-renta · ARTICULO 46`, `reglamento-renta · Artículo 1`); the
  #511 baseline will say whether they fail without this change too.

## Cost

≈US$1.60: smoke ≈0.02, r1 ≈0.30, r2 ≈0.05 (Voyage only), the abstention lane
≈1.00 (nine cases, 13 answers with their judges), the two groundedness rows
≈0.20.
