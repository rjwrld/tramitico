# The `ANSWER_TOP_K=10` run, 2026-09-15

The evidence behind «The authorized full run: `ANSWER_TOP_K=10` beside the cap
and the pin (#305)» in [`eval/README.md`](../../README.md): three arms on
`main` at #339, the 871-chunk corpus, answer `claude-sonnet-5`, judge
`claude-sonnet-4-5`, expansion `claude-haiku-4-5`. Published the way the
closing run was (#325), and copied out of the worktree the same hour, which is
the rule #304's lost transcripts wrote into CLAUDE.md. The decision the run
produced — the knob stays at 8 — is in the README; these are the rows.

| File                                                        | What it is                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `A-eval-20260915T012901Z.log`                               | Arm A, the pipeline of record (top 8, cap off, pin off): the full lane. Groundedness 69/73, adequacy 13/40, abstention 9/9 with the figure gate red.                           |
| `A-hitrate-20260915T025512Z.log`                            | Arm A's hit-rate lane alone, re-read forty minutes later because vitest hides a passing file's console: 72/73, the blocking case `ho-rebajar-25-sin-facturas` at pool #27.     |
| `A-groundedness-claude-sonnet-5-20260915T020253Z.jsonl`     | Arm A's groundedness rows: query, answer, the numbered chunk list, derived figures, the three verdicts. The answer-side omission read for #130 was made from these.            |
| `A-abstention-2026-09-15T01-31-12-512Z.jsonl`               | Arm A's abstention rows.                                                                                                                                                       |
| `B-eval-20260915T021830Z.log`                               | Arm B, `ANSWER_TOP_K=10`: the full lane. Hit-rate 71/73, groundedness 66/73 (under the gate), adequacy 17/40, abstention 8/9.                                                  |
| `B-groundedness-claude-sonnet-5-20260915T025512Z.jsonl`     | Arm B's groundedness rows — ten chunks per prompt.                                                                                                                             |
| `B-abstention-2026-09-15T02-20-53-773Z.jsonl`               | Arm B's abstention rows.                                                                                                                                                       |
| `C-groundedness-scoped-20260915T025823Z.log`                | Arm C, `ANSWER_TOP_K=10 PIN_DERIVED_INPUTS=on`, scoped by `EVAL_CASES` to the three cases the pin changes at top 10. Gates fail by design on a subset; the rows are the read.  |
| `C-groundedness-claude-sonnet-5-subset-…jsonl`              | Arm C's three rows: 3/3 grounded, F1 with both BMC figures resolved, stated and completely cited.                                                                              |
| `C-abstention-20260915T030043Z.log` · `C-abstention-…jsonl` | The whole abstention lane under top 10 + pin: 9/9, no figure on any ABS case.                                                                                                  |
| `probe-answer-set-probe.log`                                | The deterministic probe (`pnpm answer-set-probe`) over 12 configurations of top-k × cap × pin: the table that retired the `10 + cap 3` arm.                                    |
| `probe-tokens-A.txt` · `probe-tokens-B.txt`                 | Prompt tokens per ask (`pnpm prompt-tokens`), rebuilt from each arm's rows: mean 12 147 at top 8, 14 068 at top 10.                                                            |
| `dead/B-eval-20260915T020254Z.log`                          | The first attempt at arm B, discarded whole: the Anthropic balance ran out in its groundedness lane. Kept so the 72/73 hit-rate it read at top 10 is on record as not counted. |
| `dead/C-eval-20260915T021635Z.log`                          | The first attempt at arm C, killed after the same error.                                                                                                                       |

The logs' `RUN` line names the worktree the run was executed from; that
absolute path is replaced with `<worktree>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
