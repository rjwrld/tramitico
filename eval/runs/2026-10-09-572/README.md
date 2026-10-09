# A figure's sentence carries its own marker; a date compared is the plazo asked, 2026-10-09 (#572)

Fixed-chunk replays of Wave D's lane
([`runs/2026-10-09-497-wave-d/lane/`](../2026-10-09-497-wave-d/README.md)), a
control on main's prompt (cdef9d6, #569 merged) and one round of the prompt
change. Setup is #557's ([`runs/2026-10-08-557/`](../2026-10-08-557/README.md)):
`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, every
other knob at its code default. The replays answer on the recorded chunks with
today's date (2026-10-08 in Costa Rica), so only the prompt moves. The control
ran from the main checkout, the round from this worktree, both at cdef9d6, so
the scoped abstention draws saw the same retrieval. Paths in the logs read
`<worktree>` and `<main-checkout>`. The transcripts are also in the main
checkout's `eval/transcripts/2026-10-09-572/`.

## The two slips, before any paid call

`marker-check.sh` (this directory, jq only, free) prints every sentence of an
answer that states a figure (¢…, …%) with no [n] of its own, and every
sentence that says a date «ya pasó» or «ya venció». A sentence ends where
`SENTENCE_END` in `src/lib/eval/adequacy.ts` ends one. It is stricter than the
abstention gate's `figureMentions`, which counts a figure as cited if any one
of its mentions is. A hit is a lead; the reads below are by hand.

```sh
bash eval/runs/2026-10-09-572/marker-check.sh <transcript.jsonl>...
```

**The figure.** Wave D's one red, `ho-abs-devs-exentos-renta`: «Sobre el IVA,
los servicios de desarrollo de software tienen código CABYS con IVA de 13%.»
with no marker, and `cabys-dev` cited [1] in the example after it. Rule 2
already said a citation backs only its own sentence; the model still left the
general statement bare and cited its example. On the same lane the check finds
9/101 groundedness answers with such a sentence, among them
`rb-seguimiento-de-cuanto-multa` («la sanción se rebaja en un 75%.», [8] one
sentence later) and `rb-corto-que-cabys` («…todos con IVA de 13%:» over the
list that cites). Of the 25 committed abstention rows of
`ho-abs-devs-exentos-renta`, 8 carry one.

**The date.** `renta-plazo-followup` asks when to file the annual declaración,
whose plazo runs after 31 December. #557's control d2 wrote «La fecha de
setiembre de 2026 ya pasó» (judges fail 3/3) and its round 1 d2 «Por lo tanto,
la fecha de setiembre de 2026 ya pasó [9]» (fail 3/3); Wave D's lane row wrote
«El de setiembre de 2026 ya pasó» (pass). The date is the pagos parciales',
which the documents give as «el último día hábil de marzo, junio y setiembre
de cada año». The slip breaks rule 3's «Compare solo fechas que los documentos
escriben: no suponga una fecha que no traen»: the year is the model's, and the
date belongs to an obligation the question did not ask about. Wave D's
`ho-t2-tipo-de-cambio` has the same shape: «al 30 de setiembre de cada
ejercicio fiscal … Esa fecha de este año ya pasó.»

## The prompt change (round 1)

- Rule 2, after «ni los elementos de la lista o la tabla que introduce»: «Por
  eso la oración que da una cifra, un porcentaje o un monto lleva su propia
  cita aunque la siguiente cite el mismo documento con un ejemplo, la otra
  mitad de la regla o la lista que ella introduce: «la tarifa es de …% [n]. Por
  ejemplo, … [n].», no «la tarifa es de …%. Por ejemplo, … [n].».» The example
  carries no amount (#505).
- Rule 3, after «el plazo del 15 de octubre ya pasó»: «Esa comparación es solo
  para el plazo por el que la persona pregunta: no diga si ya pasó la fecha de
  otra obligación que la respuesta menciona de paso, como un pago parcial
  cuando la pregunta es por la declaración, ni le ponga el año en curso a una
  fecha que los documentos dan para cada año («la cuota de setiembre de 2026
  ya pasó»).»

## The replay set

The same for the control and the round:

- `targets-d{1,2,3}-….log`: `pnpm answer-replay` on Wave D's lane rows of
  `renta-plazo-followup`, `ho-t2-tipo-de-cambio`, `rb-corto-que-cabys` and
  `rb-seguimiento-de-cuanto-multa`, three draws. The control's d1 is
  `smoke-d1-….log` (the first three) plus `targets-d1b-….log`
  (`rb-seguimiento-de-cuanto-multa`).
- `abstention-d{1,2,3}-….log`: `ho-abs-devs-exentos-renta` ×3 through the
  scoped abstention lane (`EVAL_CASES=ho-abs-devs-exentos-renta`, live
  retrieval). An abstention row carries no chunks, so `answer-replay` cannot
  replay it. A scoped lane ends red by design; the reads are its `abstention:`
  line, the row's `figures` and the answer.
- `tier1-….log`: `pnpm answer-replay --tier=1` on Wave D's lane, 27 rows, the
  regression guard. The round runs it only once its targets pass.

## Pass bar

Set before the control. A target answer **passes** when, read by hand with
`marker-check.sh`'s hits as leads, every sentence that states a sourced figure
carries its own marker, and no sentence says a date passed other than the
plazo asked about, or with a year the documents don't write.
`ho-abs-devs-exentos-renta` must also decline.

The change **passes** when each target passes on **≥ 2 of 3** draws; the Tier
1 guard's requirements stated are **not more than 4 below the control's**;
there is **no new false absence claim**; and there is **no new Tier 1 judge
failure** (a row the judges pass on the control and fail on the round is
re-asked twice, and fails on 2 of 3 answers, #474). At most three rounds; no
tuning toward a number (ADR 0023).

## The control, on main's prompt

From the main checkout at cdef9d6 (= origin/main, clean), `control/`.
Transcripts by draw: `020228` d1 (three targets, the smoke), `020338` d1
(`rb-seguimiento`), `020433` d2, `020523` d3, `021410` the Tier 1 guard;
`abstention-subset-…` the three scoped draws. No row errored and no log
carries `config: unknown knob value`.

| Target                           | d1                                                                             | d2                                   | d3                                                                     | Passes        |
| -------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------- | ------------- |
| `renta-plazo-followup`           | ✗ «Como ya pasó el último día hábil de setiembre, esa tercera cuota ya venció» | ✓                                    | ✗ «Los de marzo, junio y setiembre de 2026 ya vencieron» (judges fail) | **1/3**       |
| `ho-t2-tipo-de-cambio`           | ✓                                                                              | ✓                                    | ✓                                                                      | 3/3           |
| `rb-corto-que-cabys`             | ✓                                                                              | ✓                                    | ✓                                                                      | 3/3           |
| `rb-seguimiento-de-cuanto-multa` | ✓                                                                              | ✗ «la sanción se rebaja en 75%.», ×3 | ✓                                                                      | 2/3           |
| `ho-abs-devs-exentos-renta`      | ✓                                                                              | ✓                                    | ✗ «…tienen IVA del 13% según el CABYS.»                                | 2/3, declines |

The abstention gate's `figures` read empty on all three control draws: d3's
13 % is cited in another sentence, so `figureMentions` counts it cited. The
check here reads each mention. Three of the five targets already pass on
main's prompt; `renta-plazo-followup` is the one the date clause has to move.

**Tier 1 guard (control): 92/116 requirements stated** (the lane recorded
88), grounded 27/27, false absence claims 0 → 0, absence openings 2 → 2
(`ho-cabys-paginas-web`, `ho-desinscribir-debiendo-declaraciones`).

## Round 1

From this worktree, `round1/`. Transcripts by draw: `021644` d1, `021742` d2,
`021827` d3, `022831` the Tier 1 guard, `022949`/`023011` the re-asks of
`ho-tambien-asegurado-por-patrono`; `abstention-subset-…` the three scoped
draws. No row errored and no log carries `config: unknown knob value`.

| Target                           | d1  | d2                                                      | d3  | Passes                 |
| -------------------------------- | --- | ------------------------------------------------------- | --- | ---------------------- |
| `renta-plazo-followup`           | ✓   | ✓ (judges fail on «hoy es 8 de octubre de 2026», below) | ✓   | **3/3**                |
| `ho-t2-tipo-de-cambio`           | ✓   | ✓                                                       | ✓   | 3/3                    |
| `rb-corto-que-cabys`             | ✓   | ✓                                                       | ✓   | 3/3                    |
| `rb-seguimiento-de-cuanto-multa` | ✓   | ✓                                                       | ✓   | **3/3**                |
| `ho-abs-devs-exentos-renta`      | ✓   | ✓ «…(CABYS 8314300000000) tienen IVA de 13% [1].»       | ✓   | **3/3** (declines 3/3) |

`renta-plazo-followup` gives the pagos parciales as the documents do («…de
marzo, junio y setiembre de cada año [9]») on every draw and says of none of
them that it passed; what it compares with today is the period's close, the
plazo asked. Its judges read 2/3, as on the control. d2 also writes «y yo no
la calculo», a #557 first-person refusal (reported). `ho-t2-tipo-de-cambio`
opens with an absence claim on d2 and d3 (control: d3), reported.

**Tier 1 guard: 89/116** (control 92, so 3 below, inside the margin), false
absence claims 0 → 0, absence openings 2 → 3 (adds
`ho-minimo-caja-independiente-2026`, which #557's round 1 also opened with).
Grounded 26/27: `ho-tambien-asegurado-por-patrono` failed 3/3 on «Para IVM,
la ficha técnica indica que el porcentaje global sube a 11,66% … [2]», read
against the escala's 9.91 %. It is #556's `ho-800-mil` reading: the control's
answer makes the same claim with the same citation and passed. Both re-asks
passed, one of them with the 11,66 % claim, so it fails 1 of 3: **no new judge
failure**. `ho-hasta-que-dia-tengo-iva` went 3/3 → 2/3 requirements, missing
«Qué hacer si la fecha ya pasó» (it compares the simplified regime's October
plazo with today, and sends the consequences of a late filing to Hacienda);
the lane recorded 2/3 too, so one draw does not separate the date clause from
noise. The check's figure hits on the guard are the reader's own «¢800.000»
and `ho-rebajar-25-sin-facturas`'s «el 25%» named as an option after a cited
first mention; its date hits are the asked plazo (`ccss-ventana`) and
conditionals.

**Round 1 meets the bar**: every target passes on at least 2 of 3, the guard
is within 4 of the control, no new false absence claim, no new judge failure.

## Found, not fixed

- The groundedness judge (`buildJudgePrompt`, `src/lib/eval/groundedness.ts`)
  is never given today's date, so a correct comparison rule 3 allows can fail
  as unsupported: control d3 and round 1 d2 of `renta-plazo-followup` were
  failed on «hoy es 8 de octubre de 2026», «the current date is not October 8,
  2026». It is one reason the judges pass a date comparison unevenly.
- #557's first person still turns up on these rows: «así que no la fijo yo»
  (Wave D's lane), «y yo no la calculo» (round 1 d2), «no puedo precisar si
  los 24 meses ya vencieron» (round 1's `ho-cobrar-8-anos-atras-caja`).

## Cost

Estimated at #556's measured replay rate (≈US$0.043 a row) and ≈US$0.10 a
scoped abstention draw (#557's figure); there is no console figure. Output
tokens ran 592–1,750 a row, in line with #556's.

| Step                               | Rows | ≈US$     |
| ---------------------------------- | ---- | -------- |
| Control smoke                      | 3    | 0.13     |
| Control, rest of the targets       | 9    | 0.39     |
| Control, abstention ×3             | 3    | 0.30     |
| Control, Tier 1 guard              | 27   | 1.16     |
| Round 1, targets ×3                | 12   | 0.52     |
| Round 1, abstention ×3             | 3    | 0.30     |
| Round 1, Tier 1 guard              | 27   | 1.16     |
| Round 1, re-asks of `ho-tambien-…` | 2    | 0.09     |
| **Total**                          |      | **4.05** |

The transcripts embed the text of the retrieved chunks, which are excerpts of
official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0
license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md). The
answers are model output about public law and contain no user data.
