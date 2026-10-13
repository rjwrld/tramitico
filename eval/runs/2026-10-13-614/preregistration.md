# #614 + #618 pre-registration: the rows, the guard and the bar

Committed on 2026-10-13, as of main 367f391, before any paid draw of this
round. Nothing here changes once the first draw has run. A result that misses
the bar is reported as a miss, and the bar is not moved to fit it. One prompt
round, no round 2 (ADR 0023): if it fails, the PR carries the evidence only,
and the prompt and its tests move to a branch, as #600 planned.

## The change

One prompt round for both issues, rules 7 and 9 only (`src/lib/answer/prompt.ts`):

- **#614, rule 9**, after the scale sentence it widens: when the question is
  which one applies, or whether one thing can stand in for another, and the
  set carries the options or the classification the answer comes from (the
  types of comprobante, the means an obligation is met with, the scales or
  categories an income falls in), the answer gives those options with their
  citation, not a summary of them, and says which one the person's case falls
  in. If the documents don't let it place the case, it says which datum
  decides. Rule 3 already says placing a datum in a category is not a
  calculation.
- **#618, rule 7**, after the salario-base example: the closing referral needs
  no reason, in 4b's answer too, so it isn't justified by what is missing
  (not «esos tramos no vienen reproducidos en lo que consulté, por lo que
  confírmelos con Hacienda», but «los tramos que rigen para su período
  confírmelos con Hacienda»). The prose sentence adds «lo que consulté» and
  «lo que recibí» to the forms the answer doesn't use.

## Input

The confirming lane's groundedness transcript,
[`../2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl`](../2026-10-12-497-confirm/lane/groundedness-claude-sonnet-5-5-effort-low-20261012T233756Z.jsonl)
(main b416b54). The main checkout's copy under
`eval/transcripts/2026-10-12-497-confirm/lane/` is byte-identical, and a free
`answer-replay --dry-run` rebuilt all 11 prompts below on 2026-10-13, so the
corpus still holds every chunk.

## The rows

**Targets: #611 §4's eight non-noise requirements, in six cases.** The five
list-shaped ones are #614's; the other three ride along, reported, not gated.

| Case                              | Requirement (the dataset's, short)                           | Shape        | Lane |
| --------------------------------- | ------------------------------------------------------------ | ------------ | ---- |
| `ho-tiquete-en-vez-de-factura`    | art. 9's list of comprobantes autorizados                    | list (gated) | ✗    |
| `ho-factura-electronica-o-recibo` | with what to issue: Hacienda's free facturador or a provider | list (gated) | ✗    |
| `ho-ademas-tengo-salario`         | two scales: monthly salary vs annual activity                | list (gated) | ✗    |
| `ccss-obligacion-ingreso-bajo`    | a very low income sits in categoría 1 of the scale           | list (gated) | ✗    |
| `ho-cliente-espana-lleva-iva`     | documented with the factura electrónica de exportación       | list (gated) | ✗    |
| `ho-tiquete-en-vez-de-factura`    | an emitter is in the RUT with a valid email                  | reported     | ✗    |
| `ho-cliente-espana-lleva-iva`     | hecho generador: invoice or service, whichever is first      | reported     | ✗    |
| `ho-donde-me-afilio-caja`         | monthly cuota, by the first letter of the first surname      | reported     | ✗    |

The six cases state 16 of their 29 Tier 1 requirements on the lane row.

**Guard: five Tier 1 cases the change can reach, all grounded and 20 of 21
requirements stated on the lane row.** Chosen as #600 chose its guard: rows
where the new sentences have something to act on, so a regression would show.

| Case                                     | Why it is in the guard                                                                                          | Lane |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| `ho-cabys-paginas-web`                   | a which-one question (which code) whose set has a classification but not the person's code: the over-reach risk | 2/2  |
| `ho-800-mil-que-porcentaje-caja`         | places a stated income in the CCSS scale: the new sentence's own move, already passing                          | all  |
| `ho-desde-cuanta-plata-caja`             | a threshold question beside the scale: risk of a longer, less grounded answer                                   | all  |
| `multa-iva-no-declarado`                 | blocking; a derived figure, a count hedge and a closing referral, rule 7's new sentence                         | all  |
| `ho-desinscribir-debiendo-declaraciones` | #600's guard: an absence tail and a referral                                                                    | 3/4  |

**Conflicting sources: the fixture lane** (`conflicting-sources.eval.test.ts`,
#135), three runs on the candidate, as #610 read it.

## Arms

- **Control:** main 367f391's prompt, run from the main checkout. Three draws
  of each target: the lane row (b416b54, whose prompt differs from 367f391
  only in rule 4b, #610, which no target or guard row triggers, on the same
  chunks) and two `answer-replay` draws with `--no-groundedness` (the
  requirement count is what the control is for; the lane row carries the
  judges' verdict). The guard's control is its lane row.
- **Candidate:** this branch, run from its worktree. Three `answer-replay`
  draws of the targets and one of the guard, both judges.

`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, every
other knob at its code default.

## The bar

A requirement **holds** on an arm when the adequacy judge counts it stated in
at least 2 of the arm's 3 draws (#474's rule). The round **passes** when all
of these hold:

1. **#614:** at least 4 of the 5 gated requirements hold on the candidate.
2. **No target lost:** none of the 8 target requirements holds on the control
   and not on the candidate.
3. **Targets grounded:** no target case fails the groundedness judges on 2 or
   more of its 3 candidate draws (all six pass on the lane row).
4. **Guard:** the candidate states at least 18 of the guard's 21 requirements
   (lane 20, margin 2, one draw), and no guard case fails groundedness on 2 of
   3 answers (a candidate fail is re-asked twice on its fixed chunks; the
   re-asks are a separate paid request).
5. **No new false absence claim** (#500's detector, #613's comprobante form
   included) on the candidate's target and guard rows beyond the control's.
6. **#618:** 0 first-person sentences in the three conflicting-sources
   answers, read by hand with `first-person-check.sh`'s hits as leads, and the
   conflict judge passes at least 2 of the 3 runs.

Reported, not gated: the three reported target requirements, the target and
guard rows' full Tier 1 counts, first-person hits in every replayed answer
(`first-person-check.sh`), the citation invariant and derived-figure
completeness the replay prints.
