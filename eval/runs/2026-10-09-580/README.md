# Declines that stay on the question, 2026-10-09 (#580, #585)

Wave F of map #497. The owner chose #580's option 3: one prompt change for
#580 and #585, read with #572's method
([`runs/2026-10-09-572/`](../2026-10-09-572/README.md)): fixed-chunk
`pnpm answer-replay` from Wave E's lane rows
([`runs/2026-10-09-497-wave-e/`](../2026-10-09-497-wave-e/README.md)), a
control on main's prompt, then one round. The setup is the same as #572's:
`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, and
every other knob at its code default. Both arms ran on 2b58680 (#587: the
groundedness judge sees the answer's date), so the arms differ only in the
prompt. The control ran from this worktree detached at origin/main, and the
round ran from the branch. The logs' paths read `<worktree>` and
`<main-checkout>`. The transcripts are also in the main checkout's
`eval/transcripts/2026-10-09-580/`.

**Round 1 fails the bar** on #585's first-person targets, so it stops there,
without its Tier 1 guard and without a round 2. The decline clauses (#580 and
#585's `ho-abs-calculo-personalizado`) hold 3/3.

## Before any paid call: why `ho-abs-calculo-personalizado` fails

This section reads every committed abstention row of the case, 32 of them
since 2026-09-11. It cost nothing. The case has two ways to fail:

- **Not routed** (#508's lane, 2026-10-08 lane 1): «No puedo calcular su
  impuesto exacto … » closing on «confirme con Hacienda el formulario…». Both
  answers are older than #557, which made the decline a remit to Hacienda as
  the one who determines the amount.
- **Not declined** (Wave E, judges 3/3): «El monto exacto de renta de su caso
  lo determina Hacienda; con sus datos no es posible fijarlo, porque no indicó
  sus ingresos…», then the whole method. The decline rests only on a missing
  datum, which makes it read as an offer to calculate once the data comes.
  The judge's rubric fails «the substantive answer plus a disclaimer». The 2026-10-08 lane 1
  answer has the same shape («necesito saber … su renta imponible»).

The answer sits on the judge's edge: Wave D's answer, nearly the same as Wave
E's, passed. The prompt cause is likely, not proven. #557's impersonal remit
dropped the old «aunque los diera, la liquidación no la hace este asistente»,
which left a missing datum as the only reason the model gives.

## The prompt change (round 1)

- **Rule 6c, a decline stays on the question (#580):** «Al corregir o
  declinar, quédese en lo que la pregunta pregunta: no agregue un impuesto que
  la pregunta no nombra ni sus cifras, aunque los documentos provistos los
  traigan (a quien pregunta si su oficio está exento de renta, no le dé la
  tarifa del IVA de sus servicios).»
- **Rule 6c, the remit doesn't rest on a missing datum (#585):** «Esa remisión
  no se funda en un dato que falte: aunque la persona diera sus ingresos, el
  monto lo determina la institución, así que no la explique con que no los dio
  ni le pida el dato para hacer la operación («necesito saber su renta
  imponible»).»
- **Rule 8, any refusal is a remit (#585, #557):** what the answer doesn't
  give («una operación o una liquidación con los datos de la persona, una
  fecha, un código o una decisión sobre su caso que los documentos provistos
  no fijan») is said neither in the first person nor as something this
  assistant doesn't do. The answer instead names who gives it: the
  institution, and the document when it is named. Rule 6's scope sentence
  («queda fuera de lo que cubre este asistente») is still said.

#572's clauses are untouched, and no gate moves.

## The replay set

- `targets-…log`: `pnpm answer-replay` on Wave E's lane rows of
  `renta-plazo-followup` (#557's «y yo no la calculo»),
  `renta-declaracion-plazo` («no puedo comparar este plazo») and
  `ho-cabys-paginas-web` («no puedo darle ese código»). Wave E's lane row is the
  control's d1. The control's d2 is `smoke-d2-…log`, its d3 `targets-d3-…log`.
- `abstention-d{n}-…log`: the scoped abstention lane
  (`EVAL_CASES=ho-abs-devs-exentos-renta,ho-abs-calculo-personalizado`, live
  retrieval). A scoped lane ends red by design. The reads are each row's
  verdicts, its `figures`, and the answer. Wave E's lane row is the control's
  d1.
- `tier1-…log`: `pnpm answer-replay --tier=1`, 27 rows, the regression guard.
  Only the control ran it.
- `refusal-check.sh` (this directory, jq only, free) prints every sentence
  where the answer says in the first person, or as the assistant, what it
  can't do. A hit is a lead, read by hand.

```sh
bash eval/runs/2026-10-09-580/refusal-check.sh <transcript.jsonl>...
```

## Pass bar

This bar was set before the control. A target answer **passes** when no
sentence says, in the first person or as the assistant, what the answer won't
give. An abstention answer passes when the judges pass it, its `figures` read
empty, and it adds no tax the question doesn't name. The change **passes**
when each target passes on 3 of 3 draws (or on 2 of 3 with both re-asks
passing), there is no new false absence claim, and the Tier 1 guard's
requirements stated are within 4 of the control's.

## Control (main's prompt)

| Target                         | d1 (lane)                     | d2                            | d3                                       | Passes |
| ------------------------------ | ----------------------------- | ----------------------------- | ---------------------------------------- | ------ |
| `renta-plazo-followup`         | ✓                             | ✓                             | ✓                                        | 3/3    |
| `renta-declaracion-plazo`      | ✗ «no puedo comparar …»       | ✗ «no puedo ubicar …»         | ✗ «no puedo decirle si el plazo ya pasó» | 0/3    |
| `ho-cabys-paginas-web`         | ✗ «no puedo darle ese código» | ✗ «no puedo indicarle cuál …» | ✗ «no puedo indicarle un número»         | 0/3    |
| `ho-abs-devs-exentos-renta`    | ✗ «IVA del 13%» (gate red)    | ✓                             | ✓                                        | 2/3    |
| `ho-abs-calculo-personalizado` | ✗ judges 3/3                  | ✓                             | ✓                                        | 2/3    |

**Tier 1 guard (control): 85/116 requirements stated** (the lane recorded 92),
grounded 25/27 (fails `ho-hacienda-solo-cliente-eeuu` and
`ho-cliente-espana-lleva-iva`), false absence claims 0 → 0, absence openings
2 → 2. The refusal check finds one Tier 1 hit, `ho-cabys-paginas-web`, the
target.

## Round 1

| Target                         | d1                                | d2                    | d3                               | Passes  |
| ------------------------------ | --------------------------------- | --------------------- | -------------------------------- | ------- |
| `renta-plazo-followup`         | ✓                                 | ✓                     | ✓                                | 3/3     |
| `renta-declaracion-plazo`      | ✗ «no puedo decirle si … ya pasó» | ✗ «no puedo ubicar …» | ✗ «no puedo fijar el día exacto» | **0/3** |
| `ho-cabys-paginas-web`         | ✓                                 | ✗ «no lo puedo darle» | ✗ «no puedo darlo»               | **1/3** |
| `ho-abs-devs-exentos-renta`    | ✓                                 | ✓                     | ✓                                | 3/3     |
| `ho-abs-calculo-personalizado` | ✓                                 | ✓                     | ✓                                | 3/3     |

All nine target answers are grounded, and no false absence claim appears. The
abstention rows carry no IVA aside and no figure. Two of the three
`ho-abs-calculo-personalizado` openings say the liquidation isn't done even
with the data: «su caso no se liquida aquí», «aun con ellos la liquidación
personalizada no se hace aquí». The third, d2, still leans on data:
«no hay dato en las fuentes que permita fijarlo por usted».

**Round 1 fails the bar.** Rule 8's clause doesn't reach the first-person
sentences. The model writes each of them as the second half of an absence
claim: «Los documentos oficiales no traen [la fecha de cierre / el código
CIIU], así que no puedo …». The first half already breaks rule 7. The sentence
comes from rule 3's fallback for a date that isn't there and from rule 7, not
from rule 8, where the voice is set. A round 2 would place the clause there,
and that is the orchestrator's call. The two abstention targets pass 3/3, but
the control passed them 2/2 on its scoped draws, so the replays don't separate
the clauses from noise. Only the lane failed them.

## Cost

These figures are estimates at #572's rates: ≈US$0.043 a replayed row and
≈US$0.10 a case in a scoped abstention draw. There is no console figure.

| Step                              | Rows / draws | ≈US$     |
| --------------------------------- | ------------ | -------- |
| Control smoke (targets d2)        | 3            | 0.13     |
| Control targets d3                | 3            | 0.13     |
| Control abstention ×2 (two cases) | 4            | 0.40     |
| Control Tier 1 guard              | 27           | 1.16     |
| Round 1 targets ×3                | 9            | 0.39     |
| Round 1 abstention ×3 (two cases) | 6            | 0.60     |
| **Total**                         |              | **2.81** |

The transcripts embed the text of the retrieved chunks, which are excerpts of
official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0
license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md). The
answers are model output about public law and contain no user data.
