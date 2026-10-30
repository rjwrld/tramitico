# #618 alone: rule 7's referral takes no reason, 2026-10-30

The #618 half of 2026-10-13's prompt round
([`../2026-10-13-614/`](../2026-10-13-614/)), shipped without #614's
rule-9 sentence. It was read as pre-registered in
[`preregistration.md`](preregistration.md), committed at f03851d before any
paid draw. The owner confirmed the balance before the run.

**The round passes all three bars.**

## Setup

`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, every
other knob at its code default. The candidate is this branch at f03851d, run
from its worktree.

- **Guard:** one `answer-replay` draw with both judges, on the five guard
  cases of 2026-10-13. The input is the confirming lane's transcript,
  [`../2026-10-12-497-confirm/lane/`](../2026-10-12-497-confirm/lane/). The
  control is that lane's row.
- **Conflicting sources:** `conflicting-sources.eval.test.ts`, run three times
  serially on the candidate, as #610 and #614 ran it.

| File                                         | What it is                                                        |
| -------------------------------------------- | ----------------------------------------------------------------- |
| `candidate-guard-….log` · `candidate/`       | the guard replay and its transcript                               |
| `conflicting-{1,2,3}-….log` · `conflicting/` | the three conflicting-sources runs and their transcripts          |
| `first-person.log`                           | `../2026-10-12-600/first-person-check.sh` over every answer above |

Each log is stamped before its run, so log _n_ names the transcript one stamp
later. Paths read `<worktree>` and `<main-checkout>`.

## Result

| #   | Bar                                                                        | Read                                               | Verdict |
| --- | -------------------------------------------------------------------------- | -------------------------------------------------- | ------- |
| a   | 0 first person in the three conflicting answers, judge passes ≥ 2 of 3     | 0/3 first person; judge pass, fail, pass (2/3)     | pass    |
| b   | guard ≥ 18/21 requirements, no case failing groundedness on 2 of 3 answers | 20/21 (lane 20/21), 5/5 grounded, no re-ask needed | pass    |
| c   | no new false absence claim beyond the control                              | 0 → 0                                              | pass    |

`first-person-check.sh` finds 0 hits in all 8 answers. The citation
invariant is 0, and derived figures are complete on the replay.

## What the answers did

- **No referral is justified in the first person.** Runs 2 and 3 refer with
  no reason given («Cuál de los dos decretos rige para el período que usted va
  a declarar, verifíquelo con Hacienda»).
- **Run 1 still gives an impersonal reason**: «Esos tramos no aparecen con
  sus cifras en lo recibido, así que los tramos aplicables a su caso
  confírmelos con Hacienda». That is the form the new sentence asks to drop.
  Bar a counts first person only, so it is reported here, not gated, as the
  preregistration said it would be.
- **Run 2's judge fail is about the discrepancy, not the referral.** The
  answer reads the two decrees as one per year, and the judge wanted the
  contradiction stated. #610 saw the same opening pass and fail on this
  fixture.
- **Guard absence openings, reported:** 1 → 2 (`ho-cabys-paginas-web`,
  `ho-desinscribir-debiendo-declaraciones`). Neither is a false absence claim
  (#500's detector reads 0).

## Cost

Estimated with #591's `cost.ts`, as the preregistration priced it:

- guard, 5 rows ≈US$0.49;
- conflicting-sources lane ×3 ≈US$0.30.

Total ≈US$0.79, under the US$2 hard stop. No re-asks were needed. No console
figure.

The transcripts embed the text of the retrieved chunks, which are excerpts of
official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0
license; see the rights table in the repository README.
