# Closing run, 2026-09-11

The evidence behind the closing-run section of [`eval/README.md`](../../README.md#the-closing-run-2026-09-11):
one arm, the shipped pipeline on `main` at #322, every suite once, answer
`claude-sonnet-5`, judge `claude-sonnet-4-5`, the 871-chunk corpus. Published so
the numbers the README records can be read back from the rows that produced them
(#325). Working runs still go to the gitignored `eval/transcripts/`; a run that
replaces this one as the deploy evidence gets its own dated folder here.

| File                                                  | What it is                                                                                                                                                                        |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `closing-run-20260911.log`                            | The raw vitest output of the full run (`vitest run --project eval`): hit-rate 68/73 with three expansion timeouts, groundedness 70/73, abstention 9/9, Tier 2 adequacy 12/13.     |
| `groundedness-claude-sonnet-5-20260911T013607Z.jsonl` | One row per case from the groundedness lane, as `groundedness.eval.test.ts` writes it (#289): query, answer, the numbered chunk list, derived figures and the three verdicts.     |
| `abstention-2026-09-11T01-02-10-369Z.jsonl`           | One row per abstention case (#321): question, answer, route and the judge's verdicts.                                                                                             |
| `closing-run-hitrate-rerun3-20260911.log`             | The hit-rate lane alone, third reading, after the Anthropic balance was topped up: 70/73, zero expansion failures, the blocking case hits. This is the figure the README records. |

The two logs' `RUN` line names the worktree the run was executed from; that
absolute path is replaced with `<worktree>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
