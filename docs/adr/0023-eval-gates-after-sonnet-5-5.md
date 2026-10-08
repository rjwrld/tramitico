# ADR 0023 — What the eval gates mean after Sonnet 5.5: the Tier 1 floor, and the model

Date: 2026-10-02 · Status: accepted (A); amended 2026-10-07
([#474, below](#amendment-2026-10-07-474-groundedness-and-the-blocking-gate));
the blocking column corrected 2026-10-07
([#504](https://github.com/rjwrld/tramitico/issues/504), note ² under the table) · Amends
[SPEC §9](../../SPEC.md) · Context: issues
[#449](https://github.com/rjwrld/tramitico/issues/449),
[#451](https://github.com/rjwrld/tramitico/issues/451),
[#287](https://github.com/rjwrld/tramitico/issues/287); the run in
[`eval/runs/2026-10-02-full-lane/`](../../eval/runs/2026-10-02-full-lane/)

## Context

Production answers with `claude-sonnet-5-5` at `ANSWER_EFFORT=low` since #451.¹
The Tier 1 floor of 80 requirements out of 116 was set (#287, #426) on a
single Sonnet 5 `medium` lane that stated 83. Since then each attempt to
bring 5.5 back up to 80 has cost US$7–20. Together they come to about
US$275, and none has reached the floor on a full lane:

| Full lane                      | Model, effort    | Groundedness | Blocking grounded | Tier 1 / 116 | Tier 2 | Derived figures | Abstention      |
| ------------------------------ | ---------------- | ------------ | ----------------- | ------------ | ------ | --------------- | --------------- |
| 2026-09-25 (`pin1`)            | Sonnet 5, medium | 68/73        | red (3)²          | **83**       | 13/13  | green           | 9/9, green      |
| 2026-09-28 (#449)              | 5.5, low         | 70/73        | red (1)²          | 74           | 10/13  | —               | —               |
| 2026-09-29 (#451)              | 5.5, low         | 69/73        | red (2)²          | 77           | 12/13  | red             | 9/9, figure red |
| **2026-10-02 (this decision)** | 5.5, low         | **68/73**    | **red (1)**       | **70**       | 10/13  | **green**       | **9/9, green**  |

¹ Owner-checked on 2026-10-08 for #504: the Vercel dashboard shows the variable
added on #451's day and never updated. The evidence is in
[eval/README's Quick reference](../../eval/README.md#quick-reference), note ².

² Corrected 2026-10-07 ([#504](https://github.com/rjwrld/tramitico/issues/504)).
These three cells first read red (1), — and red (1). Each committed log's
`ungrounded blocking answers` line names more:

- 2026-09-25 names three: `multa-iva-no-declarado` (the art. 79 count),
  `ho-rebajar-25-sin-facturas` and `ho-desinscribir-debiendo-declaraciones`
  ([`eval-…T180647Z.log`](../../eval/runs/2026-09-25-lane/)).
- 2026-09-28's `low` arm names one: `ho-minimo-caja-independiente-2026`
  ([`low-…T232945Z.log`](../../eval/runs/2026-09-28-sonnet-5-5/)).
- #451 names two: `ccss-obligacion-ingreso-bajo` and
  `ho-trabajitos-por-mi-cuenta`
  ([`low-…T050413Z.log`](../../eval/runs/2026-09-29-451/)).

So the sentence below that says the gate «is red on one case per run» is
wrong too. The amendment's count of 0–6 cases per lane is the right one.

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

**A, chosen by the owner on 2026-10-02.** Production keeps `claude-sonnet-5-5` at
`ANSWER_EFFORT=low`. Tier 1 requirements stated is tracked against a baseline
of 70/116, and only a lane at 65 or below fails it (`TIER1_REQUIREMENT_FLOOR`,
`src/lib/eval/adequacy.ts`). A lane that beats 70 raises the baseline. No
paid prompt round aims at a Tier 1 number. Full lanes run on a model change
or before a release, and prompt work is read on scoped replays. Groundedness
and the blocking gate stay as SPEC §9 has them. Whether they should stay
hard gates is left open, as above; the amendment below decides it.

## Consequences

- **A (applied with this ADR):** SPEC §9's Tier 1 line now reads "tracked
  against a baseline of 70/116, failing at ≤ 65". `TIER1_REQUIREMENT_FLOOR` is
  `TIER1_REQUIREMENT_BASELINE − TIER1_REGRESSION_MARGIN` (70 − 4 = 66), and the
  eval test is named after both. This run's 70 passes it. No new spend.
- **B:** `ANSWER_MODEL`/`ANSWER_EFFORT` in Vercel and the GitHub variable
  (#451's rollback commands), a prompt revert or a measured pairing, and one
  approved full lane. The floor of 80 stays.

## Amendment (2026-10-07, #474): groundedness and the blocking gate

Status: accepted (owner, decision session for
[#497](https://github.com/rjwrld/tramitico/issues/497)) · Context:
[#474](https://github.com/rjwrld/tramitico/issues/474)

The question this ADR left open is decided. Neither gate gave a decision:
no full lane had been green since 2026-09-24. The 2026-10-07 audit read the
committed runs and found the following.

- **The blocking gate failed 0–6 cases per lane** over 14 full lanes, across
  30 distinct cases. 13 of those cases failed exactly once.
- **The variance is in the answer, not the judge.** The 14 lanes had 88
  first-judge fails. Re-judging gave 82 fff and 4 fpf, and flipped only 2
  to pass. Asking the judges again cannot steady the gate; asking for the
  answer again can.
- **About half the fails are real errors.** The 18 judge reasons on the 5.5
  lanes and 2026-09-25 split into about 7 real errors (a contradiction, a
  wrong citation, a URL in no fragment), about 7 strict calls on reasonable
  inferences, and about 4 «the documents don't say X» claims, one of them
  false.

The owner chose #474's option 2 with three changes.

- **Groundedness is a tracked baseline**, with the Tier 1 mechanics above.
  The baseline is **68/73** (this ADR's 2026-10-02 lane), the margin **4**,
  so the floor is **64**, and a lane at **63 or below** fails. A lane that
  beats the baseline raises it. #512's two final lanes re-set it. The
  count is the judges' verdict on each case's first answer, over the 73
  cases outside the abstention tier and the robustness block. That is how
  the 68 was measured: before #500 existed. Seven of its 68 judge passes
  make a claim #500's detector now calls false, so counting the verdict
  after #500's override would read the same lane as 61, under the floor.
  A false absence claim fails its own zero gate instead. A dataset change
  that moves the population says so in the same change; a unit test fails
  otherwise.
- **Over 74 cases since #503.** #503 added one answerable Tier 2 case,
  `t2-inscripcion-dimex`, so the lane counts over 74. The 68/73 baseline
  was measured before it joined. The baseline (68) and the floor (64)
  stay absolute counts of grounded answers, since a new case can only add
  a pass. #511 is the first lane read over 74, and #512's final lanes
  re-set the baseline. (The orchestrator's call, acked by the owner.)
- **A blocking case fails only on 2 of 3 answers.** When the judges fail a
  blocking case's first answer, the lane asks the whole pipeline the same
  case twice more. Each new answer is judged the same way, with the same
  majority of three. The case fails when two of its three answers fail.
  The owner's estimate is about US$0.50 a lane, and #511 is the first
  lane that pays it. A re-ask that takes the weak-retrieval decline
  passes, as a first answer does: the fixed text makes no claim.
- **An answer the route would refuse counts as a failing answer** in the
  2-of-3 reading: a marker that resolves to nothing, no marker at all
  (#168), or a derived figure quoted without its inputs (#281). The
  lane's zero gates for those read first answers only, so without this a
  re-ask production would never show could be one of the two passing
  answers that clear a case. This was the orchestrator's call in review
  (#521), not part of the owner's decision.
- **The judges' failures carry a label**: `contradiction` (the answer says
  something the fragments contradict or do not contain) or `inference` (a
  defensible reading the fragments do not state in those words). A second
  call to the pinned judge gives it, so the verdict prompt the baseline was
  measured with is unchanged. It is recorded in every failing transcript
  row and on the console, and it gates nothing. It becomes a gate only if
  it agrees with a human read of #512's failures.

**#500's false-absence check stays a hard zero, and it wins over the 2-of-3
rule.** A false absence claim fails its case on whichever scored answer
makes it, the first or a re-ask, and a passing re-ask does not clear it. A
first answer that makes one is not re-asked: nothing can change the
outcome. Such a claim is a wrong statement a deterministic check proved,
not a judge's strict call that another answer might not repeat.

This clears [#358](https://github.com/rjwrld/tramitico/issues/358) row 8,
whose «cleared by» was a gate that counts a case only when it fails twice.

In code: `GROUNDEDNESS_BASELINE`, `GROUNDEDNESS_FLOOR`,
`blockingCaseVerdict` and `labelFailure` in
`src/lib/eval/groundedness.ts`, asserted by `groundedness.eval.test.ts`.
SPEC §9 carries the rule.

## #511's reading, and no ratchet (2026-10-08)

#511's baseline lane
([`eval/runs/2026-10-08-baseline/`](../../eval/runs/2026-10-08-baseline/))
grounded 72 of 74 answers and stated 86 of 116 Tier 1 requirements. Both beat
their baselines, and the rule above would raise them. The owner held them
instead, so groundedness stays at 68 (a lane fails at ≤ 63) and Tier 1 at 70
(fails at ≤ 65), for four reasons:

- it was one lane;
- Tier 1's +16 is unexplained, since the answer prompt had not changed;
- the pipeline changes again before #512 (Track 2 and #507);
- #512's two final lanes re-set both baselines anyway.

The robustness block's baseline, which #511 had to set, is 25 of 27.
