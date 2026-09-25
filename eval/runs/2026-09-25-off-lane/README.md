# The `off` lane, 2026-09-25 (#287, #352)

The evidence behind «`pin1` becomes the default (2026-09-25, #287, #352)» in
[`eval/README.md`](../../README.md): one full eval lane on `main` at 1e11248
(#425 merged: the art. 79 ruling and rule 9's «en principio» wording), the
local stack carrying the 873-chunk ingest with #420's fix, answer
`claude-sonnet-5` at `ANSWER_EFFORT=medium`, judge `claude-sonnet-4-5`. Every
retrieval knob was set on the command line (`STEPS=on STEPS_RERANK=off
EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`). Owner-approved. Its `pin1` pair is
[`2026-09-25-lane`](../2026-09-25-lane/), run an hour earlier.

| File                                                                | What it is                                                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T190223Z.log` · `…-subset-…T190334Z.jsonl`     | The three-case smoke before the lane: 3/3 grounded, `multa-iva-no-declarado` included. Gates fail by design on a subset.                                   |
| `eval-20260925T190345Z.log`                                         | The full lane: hit-rate 71/73 (blocking red), groundedness 68/73, adequacy 16/40 (Tier 1 4/27, 71/116 requirements), abstention 9/9, citation invariant 2. |
| `groundedness-claude-sonnet-5-effort-medium-20260925T193117Z.jsonl` | The full lane's groundedness rows: query, answer, numbered chunk list, derived figures, verdicts.                                                          |
| `abstention-2026-09-25T19-05-36-611Z.jsonl`                         | The full lane's abstention rows.                                                                                                                           |

The logs' paths to the checkout are replaced with `<worktree>`. Nothing else is
edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
