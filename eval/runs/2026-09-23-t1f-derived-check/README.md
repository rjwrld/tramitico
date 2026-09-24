# The derived-figure check, read on T1-F drafts (2026-09-23, #403)

The evidence behind «The derived-figure check read a table row as a quote
(2026-09-23, #403)» in [`eval/README.md`](../../README.md). Local stack
carrying the ingested corpus (#401's, 873 chunks — production still holds the
2026-09-16 ingest, 876 chunks and no `ccss-faq` transcription), answer
`claude-sonnet-5` at `ANSWER_EFFORT=medium`, rerank on, expansion on, the pin
on, top 8. No judge.

| File                                                 | What it is                                                                                                                                                                                                       |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answer-latency-probe-2026-09-23-t1f-keep-text.json` | `pnpm answer-latency-probe --prompts=6 --arms=medium --repeat=10 --keep-text` before the fix: the numbered answer set, the resolved figures, and ten drafts — 7/10 refused by `incompletelyCitedDerivedFigures`. |
| `answer-latency-probe-2026-09-23-t1f-fixed.json`     | The same command after the fix, fresh drafts: 10/10 pass both of the route's checks — on `bmc-sem-2026` only, the one figure this retrieval resolved (`ccss-escala-ivm` fell outside the top 8).                 |

Both files' `contexts` use the probe's field names at the time, `prompt` and
`n`; the probe now writes `seed` and `marker`.
