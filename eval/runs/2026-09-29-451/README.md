# Sonnet 5.5 on the adapted prompt, 2026-09-29 (#451)

The evidence for #451: `claude-sonnet-5-5` at `ANSWER_EFFORT=low` on the
branch's reworked prompt (0c20d5c, the shipped default), judge
`claude-sonnet-4-5`, the local stack carrying the 873-chunk ingest, every
retrieval knob set as the 2026-09-25 baseline set them (`STEPS=on
STEPS_RERANK=pin1 EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`). Owner-approved, ≈US$20 in all.

| File                                               | What it is                                                                                                                                                                                           |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `replay/control.log` · `…T020220Z.jsonl`           | `pnpm answer-replay` of the [2026-09-28 low arm](../2026-09-28-sonnet-5-5/)'s 27 Tier 1 rows on **main's prompt**, adequacy only: the replay's own noise (74 recorded → 73).                         |
| `replay/r1.log` · `…T021232Z.jsonl`                | The same rows on the reworked rules (c6af9b0): 77 of 116 requirements, 26/27 grounded.                                                                                                               |
| `replay/r2.log` · `…T022436Z.jsonl`                | + the closing note, first wording («use todo lo que aplica»): 80, 23/27 grounded.                                                                                                                    |
| `replay/r3.log` · `…T045554Z.jsonl`                | + the note asking for what a document says expressly: 81, 26/27 grounded.                                                                                                                            |
| `abstention-checks/abst1.log` · `…T04-58-17…jsonl` | The abstention lane on r3's wording: 8/9, two invented figures.                                                                                                                                      |
| `abstention-checks/abst2.log` · `…T05-00-56…jsonl` | After the note gave way to rule 6 (aca3935): 9/9, no invented figure.                                                                                                                                |
| `smoke-groundedness-…T050248Z.log` · `smoke/`      | The three-case smoke on the shipped default: 3/3 grounded, no provider errors. Gates fail by design.                                                                                                 |
| `low-…T050413Z.log` · `low/`                       | The full four-lane run: groundedness 69/73, Tier 1 77/116, Tier 2 12/13, abstention 9/9, citation invariant 0 — and red on blocking, derived figures and the abstention figure gate. See the README. |

The logs' paths to the checkout are replaced with `<worktree>`. Nothing else is
edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
