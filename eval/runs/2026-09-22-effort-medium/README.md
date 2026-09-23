# The answer-effort reading, 2026-09-22 (#356)

The evidence behind «The answer-effort reading (2026-09-22, #356)» in
[`eval/README.md`](../../README.md). Local stack carrying the ingested
corpus, answer `claude-sonnet-5` at `ANSWER_EFFORT=medium`, judge
`claude-sonnet-4-5`, rerank on, expansion on, the pin on, top 8. Compared
per case against [`2026-09-16-production`](../2026-09-16-production/): no
answer-path, dataset or corpus commit lands between the two.

| File                                                                       | What it is                                                                                                                                                                                                      |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `answer-latency-probe-2026-09-22.json`                                     | `pnpm answer-latency-probe`: the nine seed prompts, one generation each at the default, `medium`, `low` and thinking off — first reasoning, first text, total, reasoning vs text tokens, both invariant checks. |
| `answer-latency-probe-2026-09-22-t1f.json`                                 | The same probe, T1-F only (`--prompts=6 --arms=default,medium --repeat=5`), with the derived figures each draft left incompletely cited.                                                                        |
| `run.log`                                                                  | `vitest run --project eval --disableConsoleIntercept` over the groundedness and abstention files, `EVAL_CASES` = the 27 Tier 1 ids. The seven gate failures are the subset guard, by design.                    |
| `groundedness-claude-sonnet-5-effort-medium-subset-20260922T235814Z.jsonl` | The 27 Tier 1 rows: query, answer, numbered chunks, derived figures, the three verdicts.                                                                                                                        |
| `abstention-2026-09-22T23-46-44-767Z.jsonl`                                | The nine abstention rows (the file does not honour `EVAL_CASES`).                                                                                                                                               |
