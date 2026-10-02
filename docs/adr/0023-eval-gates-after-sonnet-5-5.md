# ADR 0023 — What the eval gates mean after Sonnet 5.5: the Tier 1 floor, and the model

Date: 2026-10-02 · Status: **proposed** (the owner chooses A or B) · Amends
[SPEC §9](../../SPEC.md) · Context: issues
[#449](https://github.com/rjwrld/tramitico/issues/449),
[#451](https://github.com/rjwrld/tramitico/issues/451),
[#287](https://github.com/rjwrld/tramitico/issues/287); the run in
[`eval/runs/2026-10-02-full-lane/`](../../eval/runs/2026-10-02-full-lane/)

## Context

Production answers with `claude-sonnet-5-5` at `ANSWER_EFFORT=low` since #451.
The Tier 1 floor of 80 requirements out of 116 was set (#287, #426) on a
single Sonnet 5 `medium` lane that stated 83. Since then each attempt to
bring 5.5 back up to 80 has cost US$7–20. Together they come to about
US$275, and none has reached the floor on a full lane:

| Full lane                      | Model, effort    | Groundedness | Blocking grounded | Tier 1 / 116 | Tier 2 | Derived figures | Abstention      |
| ------------------------------ | ---------------- | ------------ | ----------------- | ------------ | ------ | --------------- | --------------- |
| 2026-09-25 (`pin1`)            | Sonnet 5, medium | 68/73        | red (1)           | **83**       | 13/13  | green           | 9/9, green      |
| 2026-09-28 (#449)              | 5.5, low         | 70/73        | —                 | 74           | 10/13  | —               | —               |
| 2026-09-29 (#451)              | 5.5, low         | 69/73        | red (1)           | 77           | 12/13  | red             | 9/9, figure red |
| **2026-10-02 (this decision)** | 5.5, low         | **68/73**    | **red (1)**       | **70**       | 10/13  | **green**       | **9/9, green**  |

Fixed-chunk replays of the 27 Tier 1 rows (`pnpm answer-replay`) put the
same prompt at 70–75 from one replay to the next. Identical full lanes
differ by ±4 on Tier 1 (#457). The 2026-09-28 `medium` arm and this run
both read 70, on prompts five PRs apart. The judge scores completeness.
Paying for more prompt rounds aimed at 80 has not converged, because each
step is smaller than the noise.

Two facts hold on every row above, whichever model answered:

- **Groundedness sits at 67–70 of 73, astride the 94% gate.** 69 passes
  and 68 fails, so a run passes or fails it on one case.
- **The blocking gate is red on one case per run, and a different case each
  time.** On 2026-09-25 it was the art. 79 count, on #451
  `ccss-obligacion-ingreso-bajo`, and here `ho-800-mil-que-porcentaje-caja`.
  Here the answer restated a fragment («el Estado como tal aporta 1.75%
  adicional en IVM [3]») next to a figure it could not reconcile, and the
  three judges read that as an unsupported interpretation. The fragment is
  unchanged from #451's run, where the same case passed.

What 5.5 changed is Tier 1 (−6 to −13 against 83) and Tier 2. Retrieval
did not change. 5.5 drops the where/how content more often: TRIBU-CR/OVi
steps, CCSS channels, and what to do once a deadline has passed (#449). It
is 1.6× faster: 0.76 s to first text and 8.1 s in total, against Sonnet 5
medium's 1.2 s and 13.1 s.

## Options

### A — Keep Sonnet 5.5. Tier 1 becomes a tracked baseline, not a floor

- The hard gates stay what protects a reader from a wrong answer: the
  citation invariant, no invented figure while declining, derived figures
  completely cited, and abstention.
- Tier 1 requirements stated is recorded on every full lane against a
  **baseline of 70** (this run). A lane more than 4 below it (≤ 65) is a
  regression and blocks. Above that it is tracked, not tuned toward.
- Full lanes run only on a model change or before a release. Prompt work
  is read on scoped `--cases` replays (about US$0.10 a row).
- Cost: none now. The answers keep 5.5's latency. They stay less complete
  on where/how than Sonnet 5's, by roughly 6–13 requirements of 116.

### B — Roll back to Sonnet 5 at `medium`

- The model that met the floor (83/116, Tier 2 13/13), at 13.1 s in total
  against 8.1 s.
- **It is not a free rollback.** Since #451 the prompt was tuned for 5.5:
  #451's rules, then #463, #464 and #469. The owner's rule was that a
  5.5-tuned prompt never runs on Sonnet 5 (#449). B therefore means
  `ANSWER_MODEL=claude-sonnet-5` plus a choice. Either the prompt goes back
  to its pre-#451 state, which loses #463's citation clauses, #464's
  Costa Rica date and #469. Or Sonnet 5 runs on today's prompt, a pairing
  nobody has measured. Either way one more full lane (about US$7–8 at
  `medium`) is needed before the floor of 80 can be said to hold again.

### What neither option changes

The blocking gate has been red on every full lane since 2026-09-24, on
both models, and groundedness at 94% passes or fails on one case. Choosing
A or B changes neither.
Whether they stay hard gates is a decision in its own right. It is not
proposed here.

## Decision

_To be chosen by the owner: A or B._

## Consequences

- **A:** SPEC §9's "#287's floor" line becomes "tracked against a baseline
  of 70, a regression past −4 blocks". The `states at least 80 tier 1
requirements` test becomes `does not regress more than 4 below 70`. The
  regression alarm runs on the lanes that already run. No new spend.
- **B:** `ANSWER_MODEL`/`ANSWER_EFFORT` in Vercel and the GitHub variable
  (#451's rollback commands), a prompt revert or a measured pairing, and one
  approved full lane. The floor of 80 stays.
