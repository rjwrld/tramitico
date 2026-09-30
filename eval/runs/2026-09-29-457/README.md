# Where two identical runs part, 2026-09-29 (#457)

The evidence behind «Where two identical runs part (2026-09-29, #457)» in
[`eval/README.md`](../../README.md): seven `pnpm answer-set-probe` runs,
serial and back to back on the local stack carrying the 873-chunk ingest, no
answer model and no judge, every retrieval knob at its default (`STEPS=on`,
`STEPS_RERANK=pin1`, `EXPAND=on` unless stated, `RERANK=voyage`). The answer
set compared is the production cut, `top8/capoff/pinon`. Owner-approved,
≈US$1 (Haiku expansions and condensations, Voyage embeddings and reranks).

| File                                  | What it is                                                                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plain-1.json` · `plain-1.log`        | `main` as it stood (4af5489), the probe unchanged: 61 single-turn retrieval cases and 9 abstention cases, answer sets only.                                                                                                                                               |
| `plain-2.json` · `plain-2.log`        | The same, run again right after: Tier 1 same answer set on 6 of 18, 35 of 70 overall. One expansion timeout (`ho-abs-calculo-personalizado`).                                                                                                                             |
| `live-1.json` · `live-1.log`          | The instrumented probe (c212d7c) with `--follow-ups`, a flag then and the default since #456: 73 retrieval cases (the nine Tier 1 follow-ups condensed first) and 9 abstention cases, each with its query, expansion, pool, reranked order and scores, failures, timings. |
| `live-2.json` · `live-2.log`          | The same, run again: Tier 1 same answer set on 11 of 27, first difference at the expansion (14) or the condensation (2). No rerank call dropped in either run.                                                                                                            |
| `replay-1.json` · `replay-1.log`      | live-1's queries and expansions replayed (`--replay=live-1.json` at c212d7c; `EVAL_REWRITES=live-1.json` since): Tier 1 15 of 27, and 14 of 14 where no call was dropped. 60 rerank calls dropped on 19 cases.                                                            |
| `off-1.json` · `off-2.json` · `*.log` | `EXPAND=off`, twice: Tier 1 19 of 27, with 133 and 135 rerank calls dropped.                                                                                                                                                                                              |

Reproduce any comparison for free:

```
pnpm answer-set-compare eval/runs/2026-09-29-457/live-1.json eval/runs/2026-09-29-457/live-2.json
```

The plain runs predate the probe's stage fields, so their comparison names no
stage (`unknown`). The JSON carries chunk labels (`docKey·artículo·#part`) and
the rewrites the expansion and condensation models wrote. It carries no chunk
text and no user data: the questions are the dataset's.
