# Step 3: fix 1 at `STEP_PINS=3` (#611, PR #621)

`pin1`'s fresh step picks are ranked by the question's own Voyage score for
each pick, not by their rank in the question-and-expansion order. The draws
ran on 2026-10-13 from 36f2bb4, now kept on the branch
`rjwrld/611-fix1-question-score-code` (the code did not ship; see
[the close-out](../README.md)), with the README's step 3
commands and `ANSWER_EFFORT=low`. Estimated cost ≈US$1.60.

- The smoke read `rewrites: live`, and its largest `step` count was 3.
- 5 live draws and 2 frozen-rewrite draws (on `probe-1.json`'s rewrites),
  all exit 0. No rerank reading was lost (623–631 per draw). The frozen
  logs read `rewrites: replayed from …`.
- Absolute paths in the logs are replaced by repo-relative ones.

## The read ([`bars.log`](bars.log))

| Bar | Result                                                                                                                                                                 |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1  | **FAIL**: 60.9 % (195/320) vs control 53.1 %, needs ≥ 63.1 %. Floor broken: `ccss-pedir-prescripcion-cuotas` #1 4/5 → 2/5, `ccss-obligacion-ingreso-bajo` #2 5/5 → 2/5 |
| R2  | **FAIL** (Amendment 2): catalogue picks identical 19/27 (70.4 %), needs ≥ 90 %. Jaccard 0.69 vs control 0.67                                                           |
| R3  | PASS: hit-rate 70–73/74 on every draw; robustness 131/135, each ≥ 25 (Amendment 1); all-targets 49.2 vs 49.2; `isWeak` unchanged                                       |
| R4  | PASS: median size 12 vs control 11                                                                                                                                     |

Frozen pair ([`frozen-picks.log`](frozen-picks.log)): picks identical
**26/27**, not 27. `ho-rebajar-25-sin-facturas` differs. Its carrier (#18) is
0/5 in every arm.

## Against `STEP_PINS=3` alone ([`../pins3`](../pins3))

R1's total is the same, 195/320. What fix 1 moves is which rows are carried
(`carrier-recall.log`, per row):

- Up: `ho-desinscribir-debiendo-declaraciones` #27 1/5 → 5/5,
  `ho-cliente-espana-lleva-iva` #15 1/5 → 4/5, and +1 on #29, #30, #41, #51
  and #54.
- Down: `ho-hacienda-solo-cliente-eeuu` RUT · 2 (#35) 5/5 → 0/5, #1 and #2
  4/5 → 2/5 (the floor rows), and −1 on #13, #33 and #49.
- R2 rises from 16/27 to 19/27.
