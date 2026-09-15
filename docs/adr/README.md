# Architecture Decision Records

One file per decision that overturned a spec default, settled a fork in the design, or
fixed a reading of the code that a later reader could otherwise reverse by accident. Each
record carries its date, status, what it amends, and the issue that produced it. SPEC §12
names the ones the build was required to write; the rest were written when a decision
turned out to need a record.

**Numbering:** the next free number, never reused, never renumbered once linked. A record
that amends an earlier one links back; the earlier one links forward under "Amended by".
Status is `accepted` unless a later record says otherwise.

| #    | Title                                                                                                                             | Date       | Status                       | Amends                 | Context          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------- | ---------- | ---------------------------- | ---------------------- | ---------------- |
| 0001 | [SINALEVI fetch recipe (live-API revision)](0001-sinalevi-fetch-recipe.md)                                                        | 2026-07-21 | accepted                     | —                      | PR #16           |
| 0002 | [Chunk identity and artículo-boundary detection](0002-chunk-identity.md)                                                          | 2026-07-21 | accepted, amended 2026-08-04 | —                      | PR #16           |
| 0003 | [Embedding provider: voyage-3, plain retrieval mode](0003-embedding-provider.md)                                                  | 2026-08-04 | accepted                     | —                      | #19              |
| 0004 | [Citation rendering: sello chips, streamed as cumulative snapshots](0004-citation-rendering.md)                                   | 2026-08-04 | accepted                     | —                      | #22, #21         |
| 0005 | [Lexical leg: conditional AND→OR tsquery fallback](0005-lexical-and-or-fallback.md)                                               | 2026-08-05 | accepted                     | —                      | #37, #33         |
| 0006 | [Coverage-scaled fallback fusion, wider legs, structural corroboration](0006-coverage-scaled-fallback-fusion.md)                  | 2026-08-06 | accepted                     | ADR 0005               | #51              |
| 0007 | [Groundedness judge pinned to Sonnet 4.5 for temperature 0](0007-groundedness-judge-model.md)                                     | 2026-08-06 | accepted                     | —                      | #26              |
| 0008 | [Answer prose: a three-construct subset, rendered with owned code](0008-answer-markdown-rendering.md)                             | 2026-08-10 | accepted                     | —                      | #76              |
| 0009 | [Stream-first /api/ask: stages as data parts, failures inside the 200](0009-stream-first-ask.md)                                  | 2026-08-10 | accepted                     | ADR 0004               | #71              |
| 0010 | [Ingestion runs from the CLI/CI, not from an HTTP route](0010-cli-ingestion-authoritative.md)                                     | 2026-08-12 | accepted                     | SPEC §6                | #121, #128       |
| 0011 | [The answer is buffered and checked before any of it is written](0011-runtime-citation-invariant.md)                              | 2026-08-25 | accepted                     | ADR 0009               | #131             |
| 0012 | [Multi-turn is one condensed question, not a conversational pipeline](0012-multi-turn-question-condensation.md)                   | 2026-08-25 | accepted                     | SPEC §5, §6            | #132, #121       |
| 0013 | [Every abort refunds, and the pipeline expires before the platform can kill it](0013-disconnect-refunds-and-internal-deadline.md) | 2026-08-28 | accepted                     | ADR 0011               | #205, #126       |
| 0014 | [HTML FAQs own their question boundaries](0014-html-faq-question-chunks.md)                                                       | 2026-09-03 | accepted                     | SPEC §3, §4            | #258             |
| 0015 | [Coverage tiers and the required-claim contract](0015-coverage-tiers-and-required-claims.md)                                      | 2026-09-04 | accepted                     | SPEC §1, §9            | #254, #265       |
| 0016 | [Source freshness policy](0016-source-freshness-policy.md)                                                                        | 2026-09-04 | accepted                     | SPEC §3, §9            | #254, #262, #265 |
| 0017 | [Other institutions are routed, not covered](0017-other-institutions-are-routed.md)                                               | 2026-09-04 | accepted                     | SPEC §13               | #254, #264, #265 |
| 0018 | [Derived figures are computed by code](0018-derived-figures-by-code.md)                                                           | 2026-09-04 | accepted                     | SPEC §5                | #263             |
| 0019 | [The question is asked twice: expansion legs, not a different search](0019-query-expansion-legs.md)                               | 2026-09-05 | accepted                     | SPEC §5                | #286, #267       |
| 0020 | [The step the reader did not ask for: a hand-written catalogue per family](0020-step-catalogue-legs.md)                           | 2026-09-07 | accepted                     | SPEC §5                | #304, #303       |
| 0021 | [The app chrome is Spanish, everywhere](0021-spanish-chrome.md)                                                                   | 2026-08-28 | accepted                     | SPEC §1, §8; DESIGN §9 | #215             |

0021 was written on 2026-08-28 as a second "0013" and renumbered on 2026-09-14 (#28); its
date is the original one. `0008-answer-markdown-rendering/` holds the screenshots that
ADR's comparison table links to.
