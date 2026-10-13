# #614 + #618: one prompt round, read on fixed chunks, 2026-10-13

One prompt round for both issues, read as pre-registered in
[`preregistration.md`](preregistration.md), committed at 19dd5ed before any
paid draw. The owner OKed it at ≈US$3.30.

**The round fails the bar, on #614's two lines.** The #618 half passes its
own line: 0 first person in the three conflicting-sources answers, judge 3/3.
As pre-registered, this PR carries the evidence only. The prompt change and
its tests are kept on `rjwrld/614-618-prompt-code` (19dd5ed).

## Setup

`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, every
other knob at its code default. The input is the confirming lane's transcript,
[`../2026-10-12-497-confirm/lane/`](../2026-10-12-497-confirm/lane/) (main
b416b54).

- **Control:** main's prompt, run from the main checkout at 644606e. Its
  `src/` is identical to 1da0897's, whose prompt is 367f391's. It had two
  `answer-replay --no-groundedness` draws of the six target cases, and the
  lane row is the third draw. The guard's control is its lane row.
- **Candidate:** this branch at 19dd5ed, run from the worktree. It had three
  `answer-replay` draws of the targets with both judges, and the guard on d1.
- **Conflicting sources:** `conflicting-sources.eval.test.ts` run three times
  on the candidate, serially, as #610 ran it.

| File                                                                | What it is                                                                           |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `control-d{1,2}-….log` · `control/`                                 | the control replays (transcripts flagged `ungrounded`)                               |
| `candidate-d1-guard-….log`, `candidate-d{2,3}-….log` · `candidate/` | the candidate replays                                                                |
| `conflicting-{1,2,3}-….log` · `conflicting/`                        | the three conflicting-sources runs                                                   |
| `targets.log`                                                       | the eight target requirements per draw, read from each row's adequacy `missing` list |
| `first-person.log`                                                  | `first-person-check.sh` over every transcript above                                  |

Each log is stamped before its run, so log _n_ names the transcript one stamp
later. Paths read `<worktree>` and `<main-checkout>`. The transcripts are also
in the main checkout's `eval/transcripts/2026-10-13-614/`.

## Result

A requirement holds on an arm when it is stated in at least 2 of the arm's 3
draws (#474). Draws are lane/d1/d2 on the control and d1/d2/d3 on the
candidate.

| Requirement                                            | Control | Candidate |
| ------------------------------------------------------ | ------- | --------- |
| `ho-tiquete-en-vez-de-factura`: art. 9's list          | 1/3     | **2/3** ✓ |
| `ho-factura-electronica-o-recibo`: facturador          | 0/3     | 1/3       |
| `ho-ademas-tengo-salario`: two scales                  | 0/3     | 0/3       |
| `ccss-obligacion-ingreso-bajo`: categoría 1            | 0/3     | 0/3       |
| `ho-cliente-espana-lleva-iva`: exportación invoice     | **2/3** | 1/3       |
| `ho-tiquete-en-vez-de-factura`: RUT + email (reported) | 0/3     | 0/3       |
| `ho-cliente-espana-lleva-iva`: hecho generador (rep.)  | 0/3     | 0/3       |
| `ho-donde-me-afilio-caja`: cuota by surname (rep.)     | 0/3     | 1/3       |

The six target cases' Tier 1 counts, out of 29: control 16 · 18 · 17,
candidate 18 · 19 · 17.

| #   | Bar                                                                    | Read                                                      | Verdict  |
| --- | ---------------------------------------------------------------------- | --------------------------------------------------------- | -------- |
| 1   | ≥ 4 of the 5 gated requirements hold on the candidate                  | 1 of 5 (art. 9's list)                                    | **fail** |
| 2   | no target requirement holds on the control and not on the candidate    | the exportación invoice: 2/3 → 1/3                        | **fail** |
| 3   | no target case fails groundedness on ≥ 2 of 3 candidate draws          | 18/18 candidate answers grounded                          | pass     |
| 4   | guard ≥ 18/21 requirements, no new groundedness failure                | 20/21 (lane 20/21), 5/5 grounded, so no re-ask was needed | pass     |
| 5   | no new false absence claim on the candidate beyond the control         | 0 candidate, 0 control (the lane row had 1)               | pass     |
| 6   | 0 first person in the three conflicting answers, judge passes ≥ 2 of 3 | 0/3 first person, judge 3/3 pass                          | pass     |

`first-person-check.sh` finds 0 hits in all 38 answers: 12 control, 23
candidate (the guard included) and 3 conflicting. Citation invariant 0 and
derived figures complete on every replay.

## What the answers did

- **The new rule-9 sentence did not take.** The candidate still writes the
  comprobante types as «Entre los tipos de documento … están "Factura
  Electrónica", "Factura Electrónica de Exportación" y "Tiquete Electrónico",
  entre otros [5]». Rule 9 already forbade «entre otros», so a second clause
  in the same rule doesn't move it. No draw of either arm names categoría 1
  or the two scales. On d2 of `ccss-obligacion-ingreso-bajo`, the candidate
  sends «la categoría que le corresponde» to the CCSS instead of placing the
  case.
- **The exportación loss is a 1-of-3 swing on one sentence.** Both arms write
  that the type exists. The judge counts it on some draws and not others, so
  bar 2's miss is within draw noise. Bar 1 would fail without it.
- **Two #614 rows may not be fixable by the prompt** (set content):
  `ho-factura-electronica-o-recibo`'s facturador is only art. 22's storage
  clause («el sistema gratuito de comprobantes … permite el almacenamiento»).
  `ho-cliente-espana-lleva-iva`'s art. 13 lists the type name and never says
  which operation it is for.
- **#618, the conflicting tail.** None of the three answers is in the first
  person. Run 2 still gives a reason for the referral, impersonally: «La
  escala de esos tramos no aparece en lo que traen las fuentes para esta
  consulta, así que los tramos aplicables a su período confírmelos con
  Hacienda». That is rule 7's absence claim without the first person. Runs 1
  and 3 refer with no reason, in the clause's form («Esos tramos de cada
  decreto, por su parte, deben confirmarse con Hacienda»). Three runs on one
  fixture is a small read, and #610's 2/3 was on the same fixture.

## Cost

Estimated with #591's `cost.ts` (upper side, no cache discount), minus the
groundedness judge on the control. The conflicting lane is ≈US$0.10 a run. No
console figure.

| Part                                 | Rows | ≈US$     |
| ------------------------------------ | ---- | -------- |
| Control d1, d2 (adequacy judge only) | 12   | 0.61     |
| Candidate d1 (targets + guard)       | 11   | 1.07     |
| Candidate d2, d3                     | 12   | 1.26     |
| Conflicting-sources lane ×3          | 3    | 0.30     |
| **Total**                            |      | **3.24** |

Request: ≈US$3.22. No re-asks were needed.

The transcripts embed the text of the retrieved chunks, which are excerpts of
official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0
license; see the rights table in the repository README.
