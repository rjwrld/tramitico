# #618 pre-registration: rule 7's referral takes no reason, in 4b too

Committed on 2026-10-30, as of main 48d62b2, before any paid draw of this
round. Nothing here changes once the first draw has run. A result that misses
the bar is reported as a miss, and the bar is not moved to fit it. One prompt
round, no round 2 (ADR 0023): if it fails, the PR carries the evidence only,
and the prompt and its tests move to a branch, as #600 planned.

## The change

#618 alone, rule 7 only (`src/lib/answer/prompt.ts`). It is the rule-7 half of
19dd5ed, the 2026-10-13 round on `rjwrld/614-618-prompt-code`. That round
failed on #614's bars (see [`../2026-10-13-614/`](../2026-10-13-614/README.md))
and passed #618's own: 0 first person in three conflicting-sources answers,
judge 3/3, guard 20/21 and all grounded. #614 is closed as not planned, so
#618 ships without rule 9's sentence.

- After the salario-base example: the closing referral needs no reason, in
  4b's answer too, so it isn't justified by what is missing (not «esos tramos
  no vienen reproducidos en lo que consulté, por lo que confírmelos con
  Hacienda», but «los tramos que rigen para su período confírmelos con
  Hacienda»).
- The prose sentence adds «lo que consulté» and «lo que recibí» to the forms
  the answer doesn't use.

The `prompt.test.ts` case «gives rule 7's referral no reason, in 4b's answer
too (#618)» pins both. Rule 9 is untouched.

## Input

The confirming lane's groundedness transcript,
[`../2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl`](../2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl)
(main b416b54). The main checkout's copy under
`eval/transcripts/2026-10-12-497-confirm/lane/` is the same file.

**Dry run, 2026-10-30, free.** `answer-replay --dry-run` over the five guard
cases below, on this branch against the shared local corpus, rebuilt all 5
prompts ("5 prompt(s) rebuilt, no model call"), so the corpus still holds every
chunk of the guard rows.

## The rows

**Guard: the same five Tier 1 cases as 2026-10-13, all grounded and 20 of 21
requirements stated on the lane row.** Rows where rule 7's new sentences have
something to act on, so a regression would show.

| Case                                     | Why it is in the guard                                                                             | Lane |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------- | ---- |
| `ho-cabys-paginas-web`                   | a which-one question whose set has a classification but not the person's code: the over-reach risk | 2/2  |
| `ho-800-mil-que-porcentaje-caja`         | places a stated income in the CCSS scale, already passing                                          | all  |
| `ho-desde-cuanta-plata-caja`             | a threshold question beside the scale: risk of a longer, less grounded answer                      | all  |
| `multa-iva-no-declarado`                 | blocking; a derived figure, a count hedge and a closing referral, rule 7's new sentence            | all  |
| `ho-desinscribir-debiendo-declaraciones` | #600's guard: an absence tail and a referral                                                       | 3/4  |

**Conflicting sources: the fixture lane** (`conflicting-sources.eval.test.ts`,
#135), three serial runs on the candidate, as #610 and #614 ran it.

## Arms

- **Candidate:** this branch, run from its worktree: one `answer-replay` draw
  of the guard with both judges, and three conflicting-sources runs.
- **Control:** none drawn. The guard's control is its lane row; the conflicting
  lane's reference is #610's 2/3 first person and 2026-10-13's 0/3, both on
  this fixture.

`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, every
other knob at its code default.

## The bar

The round **passes** when all of these hold:

- **(a) #618:** 0 first-person sentences in the three conflicting-sources
  answers, read by hand with `first-person-check.sh`'s hits as leads, and the
  conflict judge passes at least 2 of the 3 runs.
- **(b) Guard:** the candidate states at least 18 of the guard's 21
  requirements (lane 20, margin 2, one draw), and no guard case fails
  groundedness on 2 of 3 answers (a candidate fail is re-asked twice on its
  fixed chunks; the re-asks are a separate paid request).
- **(c) No new false absence claim** (#500's detector, #613's comprobante form
  included) on the candidate's guard rows and conflicting answers beyond the
  control's (the lane row's).

Reported, not gated: the guard's full Tier 1 counts, first-person hits in every
replayed answer (`first-person-check.sh`), the citation invariant and
derived-figure completeness the replay prints, and any impersonal reason for
the referral in a conflicting answer (2026-10-13's run 2 gave one: «no aparece
en lo que traen las fuentes …»). That is rule 7's absence claim without the
first person; (a) counts first person only, as it was decided before this
round.

## Cost

Estimated with #591's `cost.ts` (upper side, no cache discount), at the
≈US$0.10 a row 2026-10-13 measured for 10–12-chunk sets with both judges
(11 rows ≈US$1.07) and ≈US$0.10 a conflicting-sources run.

| Part                                                         | Rows | ≈US$     |
| ------------------------------------------------------------ | ---- | -------- |
| Candidate guard, one draw, both judges                       | 5    | 0.49     |
| Conflicting-sources lane ×3                                  | 3    | 0.30     |
| **Request**                                                  |      | **0.79** |
| Worst-case re-asks (2 per failing guard case, all 5 failing) | 10   | 0.97     |

**Hard stop: US$2.** The request plus every possible re-ask is ≈US$1.76, under
it. If the running total reaches US$2 before the bar is read, the round stops
and is reported as incomplete, not passed.

## Order

1. This file is committed and pushed before any paid draw.
2. The owner confirms the API balance (runbook §7), then OKs the request.
3. Guard draw, then the three conflicting runs, serially; re-asks only on a
   groundedness fail.
4. Evidence (`README.md`, logs, transcripts copied out of the main checkout's
   `eval/transcripts/`) is committed to `eval/runs/2026-10-30-618/` before the
   PR merges.
