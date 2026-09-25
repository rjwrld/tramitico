# #352's req. 5, on `pin1`, 2026-09-24 (#352, #287)

The evidence behind «Req. 5 on `pin1` (2026-09-24, #352, #287)» in
[`eval/README.md`](../../README.md): one full eval lane on #287's branch (the
catalogue additions, the BMC figure group, the carrier printer and the
requirement-coverage count), the local stack carrying the same 873-chunk ingest
as [`2026-09-24-352`](../2026-09-24-352/), answer `claude-sonnet-5` at
`ANSWER_EFFORT=medium`, judge `claude-sonnet-4-5`. Every retrieval knob was set
on the command line (`STEPS=on STEPS_RERANK=pin1 EXPAND=on RERANK=voyage
PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8 ANSWER_DOC_CAP=off`). The owner approved
counting it as #352's req. 5.

| File                                                                               | What it is                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T013254Z.log` · `smoke-groundedness-…-subset-…T013401Z.jsonl` | The three-case smoke read (cents) before the lane: `multa-iva-no-declarado`, `ho-iva-en-cero-sin-facturar`, `ccss-cuanto-pago-base`. 3/3 grounded, both Tier 1 cases adequate. Gates fail by design on a subset. |
| `eval-20260925T013410Z.log`                                                        | The full lane. Hit-rate 72/73 (carriers 16/47), groundedness 67/73, adequacy 16/40 (Tier 1 6/27, 70/118 requirements), abstention 9/9 with the figure gate red, citation invariant 0.                            |
| `groundedness-claude-sonnet-5-effort-medium-20260925T020238Z.jsonl`                | The full lane's groundedness rows: query, answer, numbered chunk list, derived figures, verdicts.                                                                                                                |
| `abstention-2026-09-25T01-35-53-693Z.jsonl`                                        | The full lane's abstention rows.                                                                                                                                                                                 |

The logs' paths to the worktree and the session scratchpad are replaced with
`<worktree>` and `<scratchpad>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
