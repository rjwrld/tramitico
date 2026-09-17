# The first run on production, 2026-09-16

The evidence behind «The first run on production (2026-09-16, #29)» in
[`eval/README.md`](../../README.md): one arm, `eval.yml` on `main` at #347
against the production Supabase project
([run 35054635623](https://github.com/rjwrld/tramitico/actions/runs/35054635623)),
the 876-chunk corpus, answer `claude-sonnet-5`, judge `claude-sonnet-4-5`,
expansion `claude-haiku-4-5`, rerank on, expansion on, the pin on (#344), top 8. Published the way the closing run (#325) and the #305 run were, because the
workflow's own `eval-transcripts` artifact expires after 90 days and the
README's numbers should not.

| File                                                  | What it is                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `eval-ci-35054635623.log`                             | The `pnpm test:eval --disableConsoleIntercept` step of the workflow run, every lane once. Hit-rate 70/73, groundedness 69/73, adequacy 18/40 (Tier 1 6/27, Tier 2 12/13), abstention 8/9, census 187/187 over 876 chunks. Three files fail: the per-case gates of #324, #130 and #168. |
| `groundedness-claude-sonnet-5-20260916T044640Z.jsonl` | The groundedness rows: query, answer, the numbered chunk list, derived figures, the three verdicts. The 21 Tier 1 adequacy misses #352 classifies (its text says 22; the log has 6 passes of 27) are read from these.                                                                  |
| `abstention-2026-09-16T04-52-06-760Z.jsonl`           | The abstention rows: 8/9, `ho-abs-calculo-personalizado` answers with the method instead of declining.                                                                                                                                                                                 |

The log is the workflow's step output with its ANSI colour codes removed;
the runner masks the secrets it was given as `***`. Nothing else is edited.
The groundedness file was written by the lane with an empty `ANSWER_MODEL`
in its name (the workflow leaves the variable unset and the code takes the
default); it is renamed here to say which model answered.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
