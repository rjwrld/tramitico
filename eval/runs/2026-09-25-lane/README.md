# The next authorized lane, 2026-09-25 (#352, #287)

The evidence behind «The next authorized lane (2026-09-25, #352, #287)» in
[`eval/README.md`](../../README.md): one full eval lane on `main` plus the art.
79 ruling (commit b903427), the local stack carrying the 873-chunk ingest with
#420's fix, answer `claude-sonnet-5` at `ANSWER_EFFORT=medium`, judge
`claude-sonnet-4-5`. Every retrieval knob was set on the command line
(`STEPS=on STEPS_RERANK=pin1 EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on
ANSWER_TOP_K=8 ANSWER_DOC_CAP=off`). Owner-approved.

| File                                                                                    | What it is                                                                                                                                         |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T175732Z.log` · `…-subset-…T175851Z.jsonl`                         | The three-case smoke before the art. 79 change: 2/3 grounded, `multa-iva-no-declarado` failed 3/3 on the rule 9 hedge. Gates fail by design.       |
| `hitrate-pin1-rerank-2.5-…T175924Z.log`                                                 | `RERANK_MODEL=rerank-2.5`, retrieval only: 72/73, carriers 15/47, blocking red (`ho-cliente-espana-lleva-iva` cut from pool #2). Not adopted.      |
| `smoke-art79-r1-…T180526Z.log` · `smoke-art79-r2-…T180558Z.log` · two `…-subset-…` rows | `multa-iva-no-declarado` alone after the art. 79 change: grounded 2/2.                                                                             |
| `eval-20260925T180647Z.log`                                                             | The full lane: hit-rate 71/73, groundedness 68/73, adequacy 24/40 (Tier 1 11/27, 83/116 requirements), abstention 9/9 green, citation invariant 0. |
| `groundedness-claude-sonnet-5-effort-medium-20260925T183420Z.jsonl`                     | The full lane's groundedness rows: query, answer, numbered chunk list, derived figures, verdicts.                                                  |
| `abstention-2026-09-25T18-08-40-433Z.jsonl`                                             | The full lane's abstention rows.                                                                                                                   |

The logs' paths to the checkout are replaced with `<worktree>`. Nothing else is
edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
