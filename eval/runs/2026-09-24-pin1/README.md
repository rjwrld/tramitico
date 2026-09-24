# The `STEPS_RERANK=pin1` run, 2026-09-24

The evidence behind «One step pick, not one per sentence (2026-09-24, #311)»
in [`eval/README.md`](../../README.md): two arms on this branch (the `pin1`
mode, #311), the local stack carrying #408's corpus, answer `claude-sonnet-5`
at `ANSWER_EFFORT=medium`, judge `claude-sonnet-4-5`. Every retrieval knob was
set on the command line to its production value (`STEPS=on EXPAND=on
RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8 ANSWER_DOC_CAP=off`) so the
symlinked `.env.local` could not move either arm. The decision the run
produced — the default stays `off` — is in the README; these are the rows.

| File                                                                     | What it is                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `off-eval-20260924T050710Z.log`                                          | Arm `off`, the shipped default: the full lane. Hit-rate 71/73, groundedness 64/73, adequacy 16/40 (Tier 1 5/27), abstention 9/9 with the figure gate red, the derived-figure gate red.                                 |
| `off-groundedness-claude-sonnet-5-effort-medium-20260924T053526Z.jsonl`  | Arm `off`'s groundedness rows: query, answer, the numbered chunk list, derived figures, the verdicts.                                                                                                                  |
| `off-abstention-2026-09-24T05-08-59-550Z.jsonl`                          | Arm `off`'s abstention rows.                                                                                                                                                                                           |
| `pin1-eval-20260924T053546Z.log`                                         | Arm `pin1`'s full lane. Hit-rate 71/73, abstention 8/9, conflicting sources pass. Its groundedness lane **crashed** on a judge reply the parser could not read (fixed in `9263732`); only its other lanes are counted. |
| `pin1-groundedness-20260924T065115Z.log`                                 | Arm `pin1`'s groundedness lane, re-run alone after the fix: groundedness 67/73, adequacy 18/40 (Tier 1 7/27), the derived-figure gate green.                                                                           |
| `pin1-groundedness-claude-sonnet-5-effort-medium-20260924T071937Z.jsonl` | Those rows. `pin1` appended one chunk on 60 of the 73 asks (61 classified to a family; on one, every pick was already in the cut).                                                                                     |
| `pin1-abstention-2026-09-24T05-37-31-732Z.jsonl`                         | Arm `pin1`'s abstention rows. The one case that failed (`ho-abs-me-conviene-sociedad`) classifies to no family, so `pin1` did not touch its answer set.                                                                |
| `smoke-pin1-groundedness-subset-20260924T064917Z.log` · `…065102Z.jsonl` | The three-case `EVAL_CASES` smoke read (cents) run before paying for the lane again, to prove the fixed parser and the topped-up balance end to end. Gates fail by design on a subset.                                 |
| `dead/pin1-groundedness-credit-20260924T061103Z.log`                     | The first re-run of `pin1`'s groundedness lane, discarded whole: the Anthropic balance ran out 24 minutes in.                                                                                                          |

The logs' paths to the worktree and the session scratchpad are replaced with
`<worktree>` and `<scratchpad>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
