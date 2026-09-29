# The window's date in the pool, 2026-09-29 (#456)

The evidence for #456: two `pnpm answer-set-probe` runs on the local stack
carrying the 873-chunk ingest. Neither calls an answer model or a judge. The
retrieval knobs were set on the command line to their production values
(`STEPS=on STEPS_RERANK=pin1 EXPAND=on RERANK=voyage EMBEDDINGS_PROVIDER=voyage`,
with `RERANK_MODEL`, `EXPAND_MODEL` and `CONDENSE_MODEL` empty so they fall back
to the models of record), so the symlinked `.env.local` could not move either
run. The probe sets `ANSWER_TOP_K`, `ANSWER_DOC_CAP` and `PIN_DERIVED_INPUTS`
itself. Production is `top8/capoff/pinon`. Owner-approved, ≈US$0.8 for both.

| File                                         | What it is                                                                                                                                                                                                                                                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `probe-baseline.log` · `probe-baseline.json` | `main`'s probe on `main`'s catalogue, run from the main checkout at 4af5489. It reads single-turn cases only: 61 retrieval and 9 abstention. The ventana case is a follow-up, so it is not here; the recorded transcripts are its baseline (below).                                                                                                                       |
| `probe-branch.log` · `probe-branch.json`     | The branch's probe on the branch's catalogue: 73 retrieval and 9 abstention. The 12 follow-ups are condensed first, and none fell back to its question. Each read carries the `query` retrieval ran on. The ventana case's was «¿Todavía aplica la ventana de los 24 meses para regularizar la inscripción en la CCSS sin que se cobre la deuda de los años anteriores?». |
| `pick-scores.log`                            | Voyage `rerank-2.5-lite` scores for each T1-G catalogue sentence, two other wordings of the new one, and three T1-G questions, against the 52 prescription chunks. These are the scores `pin1` compares. Voyage calls only, a fraction of a cent.                                                                                                                         |

The baseline log's path to the worktree is replaced with `<worktree>`. Nothing
else is edited.

## What the runs say

**Before.** Across every recorded groundedness transcript of the case,
`ccss-reglamento-ti` TRANSITORIO V reached the answer set twice: at the cut's
last place (#8), on 2026-09-16 and 2026-09-22. It has not reached it on any run
since 2026-09-24. The chunk states the window as a date, «La aplicación del
plazo de prescripción de 4 años regirá hasta el 8 de mayo de 2025…». The
question, its condensation and its expansion all state it as a duration
(«24 meses», «veinticuatro meses»). No leg bridges the two.

**The catalogue sentence fills the pool.** T1-G's fifth sentence mirrors the
transitorio. Its `websearch_to_tsquery` matches that chunk and no other, which
was checked in SQL. On the branch probe TRANSITORIO V reaches the answer set
of two T1-G asks that did not have it on the baseline:
`ho-cobrar-8-anos-atras-caja` (#8) and `ccss-cobro-retroactivo` (#7). The
question's own reading put it in the cut in both, once it was in the pool.

**It stops one place short on the ventana case.** There it reranks **#9** on
the question's reading, the first place past the cut. `pin1`'s one append
passes over it for «¿En qué momento puedo solicitar la prescripción de las
deudas?», s3's pick. `pin1` ranks fresh picks by each pick's score against
**its own sentence** (`pick-scores.log`): s3 0.9688 and s4 0.9688 (a quantized
tie that sentence order breaks), then TRANSITORIO V 0.9648 on every wording
tried, s1 0.9570, s2 0.9492. That score does not depend on the question, so
every T1-G ask is pinned the same chunk, and it is no T1-G case's target.
`ccss-pedir-prescripcion-cuotas` pays for it too: its fresh targets «¿Dónde
presento la solicitud?» (#22) and the 20-días chunk (#15) lose the same pin.
Changing how `pin1` ranks picks changes every family's answer set, so it is
#460 and not this issue. #456's acceptance (TRANSITORIO V in the case's answer
set) is **not met**.

**The rest of the diff is noise.** The catalogue only reaches asks that
classify to T1-G. Every answer-set change outside those four cases
(`ho-trabajitos-por-mi-cuenta` 1 → 0 targets, `desinscripcion-dejar-actividad`
5 → 3 and the others in the JSONs) is run-to-run variance in the expansion
(#457). The baseline had one expansion time out (`factura-primera-cabys`); the
branch had none.

The totals are not comparable across the two runs: the branch probe reads the
12 follow-ups the baseline skips (`top8/capoff/pinon`: 119/161 targets on the
baseline, 134/191 on the branch).
