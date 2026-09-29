# Sonnet 5.5 on today's prompt, 2026-09-28 (#449, #451)

The evidence behind «Sonnet 5.5 on today's prompt (2026-09-28, #449)» in
[`eval/README.md`](../../README.md): answer `claude-sonnet-5-5` on `main` at
1421703 (#450 merged, `@ai-sdk/anthropic` 4.0.67), judge `claude-sonnet-4-5`,
the local stack carrying the 873-chunk ingest. Every retrieval knob was set on
the command line, as the 2026-09-25 baseline set them (`STEPS=on
STEPS_RERANK=pin1 EXPAND=on RERANK=voyage PIN_DERIVED_INPUTS=on ANSWER_TOP_K=8
ANSWER_DOC_CAP=off`). Only the four lanes that write an answer ran: groundedness,
abstention, conflicting-sources and amending-law. Owner-approved, ≈US$13–14.

| File                                                     | What it is                                                                                                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `latency-probe.json` · `latency-probe-…T222611Z.log`     | `pnpm answer-latency-probe --arms=default,medium,low,off` on the nine seed prompts. The `off` arm sends `thinking: between_tools`.                |
| `smoke-groundedness-…T223344Z.log` · `smoke/`            | The three-case smoke at `medium`: 3/3 grounded, no provider errors. Gates fail by design.                                                         |
| `medium-…T223518Z.log` · `medium/`                       | Arm `ANSWER_EFFORT=medium`: groundedness 72/73, Tier 1 70/116, Tier 2 10/13, abstention 8/9, citation invariant 0.                                |
| `low-…T232945Z.log` · `low/`                             | Arm `ANSWER_EFFORT=low`: groundedness 70/73, Tier 1 74/116, Tier 2 10/13, abstention 9/9, citation invariant 0.                                   |
| `medium/groundedness-…jsonl` · `low/groundedness-…jsonl` | Each arm's groundedness rows: query, answer, numbered chunk list, derived figures, verdicts, and `generation.{finishReason,outputTokens}` (#450). |
| `medium/abstention-…jsonl` · `low/abstention-…jsonl`     | Each arm's abstention rows.                                                                                                                       |

The logs' paths to the checkout are replaced with `<worktree>`. Nothing else is
edited.

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
