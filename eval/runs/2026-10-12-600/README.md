# First person outside declines, rules 3 and 7, 2026-10-12 (#600)

#593 item 3, read from Wave G's lane
([`runs/2026-10-10-497-wave-g/`](../2026-10-10-497-wave-g/README.md), main
e7d954c): answers that are not declines still speak about the assistant. The
owner approved one prompt round on 2026-10-12. The method is #572's and
#594's ([`runs/2026-10-09-572/`](../2026-10-09-572/README.md),
[`runs/2026-10-09-580/`](../2026-10-09-580/README.md)): fixed-chunk
`pnpm answer-replay` of Wave G's lane rows, a control on main's prompt, then
one round with the change, on the same rows and the same number of draws.
The setup is theirs: `claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge
`claude-sonnet-4-5`, every other knob at its code default. Both arms ran from
this worktree on the same tree: the control at a39df82 (= origin/main then),
the round at bfe8e7e, which differs from it only in the prompt and its tests.
The logs' paths read `<worktree>` and `<main-checkout>`, and the transcripts
are also in the main checkout's `eval/transcripts/2026-10-12-600/`.

**Round 1 passes the bar.** The targets go from 5 of 10 answers free of first
person on the control to 10 of 10, the Tier 1 guard from 27 to 30 of 37, with
no new groundedness failure, no false absence claim, and the four abstention
cases passing.

## The prompt change

#594's lesson: the first-person sentence is the tail of an absence claim
(«los documentos no traen X, así que no puedo …»), so the clause goes where
that claim is governed, rules 3 and 7, not rule 8. Two of Wave G's phrasings
echo the prompt's own words: rule 7 tells the model «lo que no tiene a la
vista» and «refiérase a lo que consultó», and the answers write «los
documentos que tengo a la vista» and «los documentos que consulté».

- **Rule 7, after the salario-base example:** a missing datum isn't said in
  the first person either, since it is the same claim said about the
  assistant: not what it doesn't find, doesn't have in view or can't
  determine, confirm or give (the four Wave G phrasings as examples). The
  answer says what the sources do say on the point, with its citation, and
  names what is left as what the person confirms: not «no puedo confirmar si
  su servicio al exterior está gravado», but «si su servicio al exterior está
  gravado, confírmelo con Hacienda». The sentence after it is unchanged:
  «Cuando nada de lo que recibió responde la pregunta, rige la regla 6», so a
  decline keeps rule 6's «no encuentra base oficial».
- **Rule 7, the prose sentence:** the documents are «los documentos oficiales»
  or «las fuentes», not the ones the assistant consulted, received or has in
  view.
- **Rule 3, the date fallback:** «diga que esa fecha debe confirmarla con la
  institución» gains «dígalo de la fecha, no de usted: no «no encuentro esa
  fecha» ni «no puedo decirle si ya pasó», sino «si ese plazo ya venció,
  confírmelo con la institución».»

Rules 6, 6c and 8 are untouched, and no gate moves.

## The replay set

- **Targets** (`targets-d{n}-….log`): the five rows #600 names, Wave G's lane
  rows of `rb-pill-inscribo-exterior` («no lo puedo determinar con los
  documentos que consulté»), `ho-cabys-paginas-web` («no puedo darle uno sin
  inventarlo»), `ho-t2-payoneer` («Lo que no puedo confirmar con las
  fuentes»), `ccss-ventana-prescripcion-24-meses` («No encuentro en los
  documentos oficiales…») and `rb-tilde-inscribirme-afuera` («los documentos
  oficiales que tengo a la vista no lo detallan»). Two draws an arm. Wave G's
  lane row is context, not a draw: it answered on 2026-10-10 against an older
  main.
- **Tier 1 guard** (`tier1-guard-….log`): one draw an arm of the eight Tier 1
  rows, besides the two targets, where the clause can act, plus the two Tier 1
  targets' d1. See below.
- **Abstention** (`abstention-….log`): the scoped abstention lane
  (`EVAL_CASES=…`, live retrieval, `--project eval`) on the four cases whose
  decline is an absence or a «no puedo» sentence the clause's wording reaches:
  `ho-abs-iva-2027` («Los documentos oficiales no traen ninguna cifra para
  2027»), `ho-abs-devs-exentos-renta` («No encuentro en ellos una exención»),
  `ho-abs-calculo-personalizado` (rule 3's «deje la operación») and
  `abs-ins-riesgos-trabajo` («así que no puedo decirle si es obligatorio»).
  One draw, round only: an abstention row carries no chunks, so it can't be
  replayed, and its bar is absolute. Wave G's lane passed all four, figures
  empty. The out-of-scope declines (pasaporte, DIMEX, licencia, patentes,
  sociedades, aguinaldo, contador, tarifa) are rule 5, 6, 6a and 6b, which
  the change doesn't touch.
- `first-person-check.sh` (this directory, jq only, free) widens #585's
  `refusal-check.sh` to Wave G's absence tails («encuentro», «tengo»,
  «consulté», «recibí», «no me permiten», «le explico», «este asistente»). On
  Wave G's lane it finds 16 of 101 answers: README's 14, plus
  `ho-t2-tipo-de-cambio` («Los documentos oficiales que recibí no indican…»)
  and `rb-corto-tramos-renta`'s scope sentence. A hit is a lead, read by hand.

```sh
bash eval/runs/2026-10-12-600/first-person-check.sh <transcript.jsonl>...
```

### Why this Tier 1 guard

#594 chose the whole Tier 1 set, 27 rows, at #572's ledger rate of ≈US$0.043
a row. #591 measured ≈US$0.11 a row on today's 10–12-chunk sets, so 27 rows
an arm is ≈US$5.9 for the two, the issue's whole budget of US$6. The guard is
therefore the Tier 1 rows the clause can reach: those whose Wave G answer
carries a sentence rules 3 and 7 govern, an absence claim, a first-person
sentence or a date compared with today. They are
`desinscripcion-dejar-actividad`, `ho-factura-electronica-o-recibo`,
`ho-rebajar-25-sin-facturas` (also first person), `ho-tambien-asegurado-por-patrono`,
`ho-cobrar-8-anos-atras-caja`, `ho-desinscribir-debiendo-declaraciones`
(absence claims), `ho-iva-en-cero-sin-facturar` and `ho-hasta-que-dia-tengo-iva`
(dates compared), with the two Tier 1 targets, `ho-cabys-paginas-web` and
`ccss-ventana-prescripcion-24-meses`. Ten cases, 37 of the 116 requirements.
The other 17 Tier 1 answers carry none of those sentences, so the clause has
nothing in them to move.

## Pass bar

Set before the control, unchanged since. A target answer **passes** when no sentence speaks
about the assistant, in the first person («no puedo…», «no encuentro…»,
«tengo a la vista», «consulté», «le explico») or as «este asistente», read by
hand with `first-person-check.sh`'s hits as leads.

The round **passes** when all of these hold:

1. **Targets:** at least 8 of the 10 round answers pass, and each target
   passes on at least 1 of its 2 draws.
2. **No new groundedness failure** on the target and guard rows: a row the
   judges pass on the control and fail on the round is re-asked twice on its
   fixed chunks, and is a new failure if it fails 2 of 3 (#474).
3. **No new false absence claim**: the replay's #500 detector counts no more
   on the round than on the control, over the target and guard rows.
4. **Tier 1 guard:** the round states no more than 3 fewer of the guard's 37
   requirements than the control. The 27-row guard's margin is 4 of 116; one
   draw over 10 cases is noisier than over 27, so 3 rather than a scaled 1.
5. **Abstention:** each of the four cases passes the lane's verdict with its
   `figures` empty. A case that fails is re-run twice, and fails the bar if it
   fails 2 of 3.

One round, no round 2, no tuning toward a number (ADR 0023). If the round
fails the bar, it is a documented exception like #594: the prompt and its tests
are kept on `rjwrld/600-first-person-rules-3-7-code`, and the PR carries the
evidence only.

## Control (main's prompt)

`control/`: `smoke-d1-…` (two targets), `targets-d1b-tier1-guard-…` (the other
three targets' d1 and the guard), `targets-d2-…`. All 18 answers grounded on
the judges' first verdict; false absence claims 0; citation invariant 0.

A target ✓ is an answer with no sentence about the assistant.

| Target                               | d1                                                                      | d2                                                      | Passes   |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------- | -------- |
| `rb-pill-inscribo-exterior`          | ✗ «Los documentos que recibí no precisan…»                              | ✓                                                       | 1/2      |
| `ho-cabys-paginas-web`               | ✗ «…así que no puedo darle ese número con base oficial»                 | ✗ «…así que no puedo darle ese código con base oficial» | 0/2      |
| `ho-t2-payoneer`                     | ✗ «que tengo no responden…», «No encuentro base oficial…», «que recibí» | ✗ «que tengo a la vista…», «que recibí no tratan…»      | 0/2      |
| `ccss-ventana-prescripcion-24-meses` | ✓                                                                       | ✓                                                       | 2/2      |
| `rb-tilde-inscribirme-afuera`        | ✓                                                                       | ✓ («en estos extractos», a #75 slip, noted)             | 2/2      |
| **Total**                            |                                                                         |                                                         | **5/10** |

Wave G's lane rows failed all five, so on these rows the first person comes
and goes from draw to draw; the control's 5/10 is why the bar asks for 8.

**Tier 1 guard (control): 27/37.** The first-person check also hits three
guard answers: `ho-factura-electronica-o-recibo` («Las fuentes no me permiten
saber el suyo, así que le explico…»), `ho-rebajar-25-sin-facturas` («Los
documentos oficiales que consulté no indican…») and
`ho-cobrar-8-anos-atras-caja` («…así que no puedo decirle si esos 24 meses ya
vencieron», rule 3's missing date).

## Round 1

`round1/`: `targets-d1-tier1-guard-…`, `targets-d2-…`, `reask-payoneer-d{1,2}-…`,
`abstention-d1-…`. Every round answer was read by hand, not only the check's
hits; the check finds none in the 18 replayed answers.

| Target                               | d1  | d2                                   | Passes    |
| ------------------------------------ | --- | ------------------------------------ | --------- |
| `rb-pill-inscribo-exterior`          | ✓   | ✓                                    | 2/2       |
| `ho-cabys-paginas-web`               | ✓   | ✓                                    | 2/2       |
| `ho-t2-payoneer`                     | ✓   | ✓ (judges fail 2/3, re-asked, below) | 2/2       |
| `ccss-ventana-prescripcion-24-meses` | ✓   | ✓                                    | 2/2       |
| `rb-tilde-inscribirme-afuera`        | ✓   | ✓                                    | 2/2       |
| **Total**                            |     |                                      | **10/10** |

The tails now read as the clause asks: «Si su servicio al exterior está gravado
o no con IVA, confírmelo con Hacienda», «Cuál código CIIU 4 corresponde a su
actividad, confírmelo con Hacienda», and on the guard «La fecha exacta de su
vigencia, para saber si esos 24 meses ya vencieron, confírmela con la CCSS»
(`ho-cobrar-8-anos-atras-caja`, rule 3's clause). `ho-cabys-paginas-web` still
opens on «Los documentos oficiales no traen el código de actividad económica
(CIIU 4)…», impersonal, which the bar allows and the replay counts as an
absence opening, as on the control. `ho-t2-payoneer` writes «Los documentos
oficiales provistos» on both draws, a #75-style slip, noted.

**Tier 1 guard: 30/37** (control 27):

| Case                                     | Control | Round  |
| ---------------------------------------- | ------- | ------ |
| `ccss-ventana-prescripcion-24-meses`     | 3/3     | 3/3    |
| `ho-cabys-paginas-web`                   | 0/2     | 0/2    |
| `desinscripcion-dejar-actividad`         | 4/6     | 5/6    |
| `ho-factura-electronica-o-recibo`        | 2/4     | 2/4    |
| `ho-rebajar-25-sin-facturas`             | 2/4     | 3/4    |
| `ho-tambien-asegurado-por-patrono`       | 2/3     | 3/3    |
| `ho-cobrar-8-anos-atras-caja`            | 4/4     | 4/4    |
| `ho-desinscribir-debiendo-declaraciones` | 3/4     | 3/4    |
| `ho-iva-en-cero-sin-facturar`            | 4/4     | 4/4    |
| `ho-hasta-que-dia-tengo-iva`             | 3/3     | 3/3    |
| **Total**                                | **27**  | **30** |

**Groundedness.** 17 of 18 round answers grounded on the first verdict.
`ho-t2-payoneer` d2 failed 2 of 3 judges on a sentence the control didn't
write, in a section on a payer in Costa Rica: art. 23's 15 % retention «para
las dietas, gratificaciones y otras prestaciones por servicios personales en
relación de dependencia», which the judges read as not fitting a person paid
from abroad. It is not the sentence the clause rewrote. Both re-asks on the
same chunks passed, so it fails 1 of 3: **no new failure** (#474).

**False absence claims:** 0 on the control, 0 on the round (20 answers with the
re-asks).

**Abstention** (`abstention-subset-…`, live retrieval): all four pass the
lane's verdict on the first judge, route `model`, `figures` empty;
`ho-abs-iva-2027`'s #502 requirement 1/1. Rule 6's decline keeps its first
person where it owns it: `abs-ins-riesgos-trabajo` opens «No encuentro base
oficial sobre el seguro de riesgos del trabajo…» and routes to the INS.

| Bar item                      | Result                                   |
| ----------------------------- | ---------------------------------------- |
| 1. Targets ≥ 8/10, each ≥ 1/2 | **pass**, 10/10, each 2/2 (control 5/10) |
| 2. No new groundedness fail   | **pass**, `ho-t2-payoneer` fails 1 of 3  |
| 3. No new false absence       | **pass**, 0 → 0                          |
| 4. Tier 1 guard ≥ control − 3 | **pass**, 30 vs 27                       |
| 5. Abstention, four cases     | **pass**, 4/4, `figures` empty           |

**Round 1 passes the bar**, and the change ships with this PR.

## Found, not fixed

- `ho-abs-calculo-personalizado`'s decline leans on the missing datum again:
  «No tengo su renta neta ni sus ingresos, y además el monto exacto de su caso
  lo determina Hacienda. Lo que sí puedo darle es la regla…». It passes, but it
  is #585's shape, in the first person a decline is allowed.
- `ho-abs-devs-exentos-renta` compares a date it builds from a condition: «El
  plazo de la declaración del período anterior ya venció si el período fiscal
  terminó el 31 de diciembre.» Rule 3 compares only dates the documents write.
- `ho-t2-payoneer` («Los documentos oficiales provistos», round, both draws)
  and `rb-tilde-inscribirme-afuera` («en estos extractos», control d2) still
  name the material as the model receives it (#75).
- `ho-cabys-paginas-web` keeps its absence opening on every draw of both arms;
  its 0/2 requirements are unchanged.

## Cost

Estimated with #591's `cost.ts` (`runs/2026-10-10-591/`, upper side, no cache
discount) for the replays, plus ≈US$0.04 a re-judge, and ≈US$0.15 a scoped
abstention case. There is no console figure.

| Step                                | Rows | ≈US$     |
| ----------------------------------- | ---- | -------- |
| Control smoke (d1: two targets)     | 2    | 0.15     |
| Control rest (d1, d2, guard)        | 16   | 1.33     |
| Round 1 (targets ×2, guard)         | 18   | 1.58     |
| Round 1 abstention (4 cases)        | 4    | 0.60     |
| Round 1 re-asks of `ho-t2-payoneer` | 2    | 0.19     |
| **Total**                           |      | **3.85** |

The plan was ≈US$4.56 plus a reserve of ≤ US$1.00, under the hard stop of
US$6.

The transcripts embed the text of the retrieved chunks, which are excerpts of
official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0
license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md). The
answers are model output about public law and contain no user data.
