# The whole-colón escala and the unclosed marker, 2026-09-24 (#352)

The evidence behind «Groundedness back over the gate (2026-09-24, #352)» in
[`eval/README.md`](../../README.md): the local stack after `pnpm ingest
ccss-faq` with the escala bounds written as whole colones, the citation
invariant reading an unclosed `[n`, answer `claude-sonnet-5` at
`ANSWER_EFFORT=medium`, judge `claude-sonnet-4-5`. Every retrieval knob was set
on the command line to its production value (`STEPS=on STEPS_RERANK=off
EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`). The baseline is the `off` arm of
[`2026-09-24-pin1`](../2026-09-24-pin1/), run on `main` a few hours earlier.

| File                                                                          | What it is                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scoped-groundedness-20260924T074341Z.log` · `scoped-…-subset-…074811Z.jsonl` | The scoped read (`EVAL_CASES`, ≈US$0.70): the nine cases the baseline left ungrounded plus the derived-figure case. 8/10 grounded. Gates fail by design on a subset.                                                        |
| `eval-20260924T074841Z.log`                                                   | The full lane. Hit-rate 71/73 (blocking-case gate red: `ho-factura-electronica-o-recibo` reranked out from pool #2), groundedness 70/73, adequacy 13/40, abstention 9/9 with the figure gate red, conflicting sources pass. |
| `groundedness-claude-sonnet-5-effort-medium-20260924T081540Z.jsonl`           | The full lane's groundedness rows.                                                                                                                                                                                          |
| `abstention-2026-09-24T07-50-30-096Z.jsonl`                                   | The full lane's abstention rows.                                                                                                                                                                                            |

The logs' paths to the worktree and the session scratchpad are replaced with
`<worktree>` and `<scratchpad>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
