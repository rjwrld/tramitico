# ADR 0006 — Groundedness judge pinned to Sonnet 4.5 for temperature 0

Date: 2026-08-06 · Status: accepted ·
Context: issue [#26](https://github.com/rjwrld/tramitico/issues/26)
(`src/lib/eval/groundedness.ts`)

## Context

SPEC §9 requires the groundedness judge to run at **temperature 0** so verdicts
are as deterministic as an LLM judge gets, with the 2× re-judge/majority rule
absorbing what flakiness remains. SPEC §5 makes Claude Sonnet the default model
but says nothing about which model judges.

Two constraints discovered during implementation:

1. **Claude Sonnet 5 rejects non-default sampling parameters** — passing
   `temperature: 0` returns a 400. The current-generation Sonnet cannot honor
   the SPEC's temperature-0 requirement.
2. **The judge must not follow `ANSWER_MODEL`.** The Week 3 Sonnet-vs-Haiku
   comparison is only meaningful if both answer models face the same judge; a
   judge that switched with the env var would grade Haiku with a different
   (cheaper) referee.

## Decision

**Pin the judge to `claude-sonnet-4-5` at temperature 0** (`JUDGE_MODEL` in
`src/lib/eval/groundedness.ts`), independent of `ANSWER_MODEL`. Sonnet 4.5 is
the newest Sonnet-tier model that accepts an explicit `temperature: 0`, keeping
the letter of SPEC §9 rather than substituting "omit temperature" on Sonnet 5
(whose default is 1, i.e. sampled).

## Consequences

- Answer models change by env var; the referee never does. Comparison numbers
  in `eval/README.md` stay comparable across runs.
- When Sonnet 4.5 retires, pick the newest model that still accepts
  temperature 0 — or, if none does, amend SPEC §9 to define determinism in
  terms of the re-judge majority rule alone and move the judge to the current
  Sonnet.
- Judging quality is bounded by a previous-generation Sonnet. Acceptable at
  n≈25 for a supported/unsupported binary; revisit if the gate ever produces
  verdicts that look wrong on manual spot-checks.
