# Two deterministic slip detectors, backtested, 2026-10-08 (#558)

#556's control showed the judges passing every #546 slip (the reader's months
worked out against the tope) and every #547 hedge («las fuentes no dicen cómo
se cuenta») while the answer cited a figure labelled «Multa por cada
declaración tributaria omitida». Only a human read caught them. #558 adds two
checks, both free:

- **#547, the count hedge** (`countHedges` in `src/lib/eval/absence.ts`): a
  sentence saying the sources don't say how a figure is counted («no dicen
  cuántas veces se aplica», «no precisan cómo se cuenta», «no dice si se
  aplica una vez por cada …»), in an answer that cites every input of a
  derived figure whose label carries «por cada» or «por mes». **It gates**,
  as one more false absence claim.
- **#546, the reader's case** (`readerCaseSlips` in
  `src/lib/eval/answer-checks.ts`): an amount equal to another amount the
  answer writes, or to a derived figure the chunks resolve, times a count the
  condensed question gives («tres meses», «2 hijos», «un año» read as 12), or
  a sentence that puts the tope next to the reader's count (or «su caso») and
  says it is reached («llegaría al tope», «el tope es el límite»), without
  handing the count back. **It is reported**, never gated.

`absence-backtest.txt` is the run's full output: `pnpm absence-backtest` on
this branch, over every transcript committed under `eval/runs/` on main at
ddfb9a1 (102 files, 2,149 answers). No provider call and no database read.

## The pass bar

The bar was the #556 control slips flagged and nothing on round 2.

| Set (`runs/2026-10-08-546-547-550/`)         | #547 count hedge                                                    | #546 reader's case             |
| -------------------------------------------- | ------------------------------------------------------------------- | ------------------------------ |
| `control/`, `multa-iva-no-declarado` d1–d3   | **3/3** flagged                                                     | —                              |
| `control/`, `rb-seguimiento-de-cuanto-multa` | —                                                                   | **2/2** slips flagged (d1, d3) |
| `control/`, Tier 1 guard                     | 2 more: `ho-rebajar-multa-si-pago-ya`, `inscripcion-tardia-sancion` | 0                              |
| `round1/`                                    | 2 (d1, d3: the hedges the README quotes)                            | 0 (d1, d2 hand the count back) |
| `round2/` (targets, Tier 1 guard, re-asks)   | **0**                                                               | **0**                          |
| `lane/` (main's prompt since #556)           | **0**                                                               | **0**                          |

Round 2 d2's «Las fuentes no dicen **más** sobre cómo se cuenta la multa…»
counted as a miss in #556's human read. The detector leaves it alone on
purpose, because it no longer denies the label's count. So the gate is
narrower than that read.

## Precision on every committed run

**#547: 58 hits in 54 answers, all true.** That's 38 in
`multa-iva-no-declarado`, 17 in `ho-rebajar-multa-si-pago-ya` and 3 in
`inscripcion-tardia-sancion`, from 2026-09-25 to 2026-10-08. Each one says the
sources don't say how the cited «por cada»/«por mes» figure is counted. Before
#556 the hedge was in almost every run with that figure: both of #512's final
lanes, #511's lane, 2026-10-02's full lane, and the #451, #454, #455, #458
and #507 replays.

The first draft read 60 hits. Three shapes came out:

- «los documentos no dicen cómo se **aplica el plazo** a su caso»: a
  deadline, not a count. «Aplica» now counts only with a count after it («si
  se aplica una vez / por cada …»).
- «no precisan cómo se cuentan los meses (de atraso) **en su caso**» (×2,
  `inscripcion-tardia-sancion`): the reader's own months, which may be about
  when their clock started, and which no label says. Rule 3 leaves those to
  the reader. A «cómo se cuenta» followed by «en su caso» is left alone.

**#546: 11 hits in 11 answers, all true.** One product: `ho-abs-calculo-personalizado`
(2026-09-24 abstention lane), «Con dos hijos … ¢20.520,00 por cada uno (es
decir, ¢41.040,00 en total)». And 10 tope readings: 6 in
`rb-seguimiento-de-cuanto-multa` (#556 control d1 and d3, #507's control and
r1, both #512 final lanes) and 4 in `inscripcion-tardia-sancion` (#451 ×2,
2026-10-02's full lane, #507 r1). For example: «Como usted habla de un año sin
registrarse, la multa mensual llegaría al tope antes de completar los doce
meses» (#512 lane 1).

The first draft of the tope rule read 13, and 3 of those were false. Each was
a conditional rule statement with the reader's count beside a tope the
sentence only states: «si se inscribió un año tarde, la sanción se calcula por
los meses … con ese tope de tres salarios base», and the 1 % morosidad tope
next to «si los tres meses …». So the rule now needs the tope reached
(`REACHED`).

## What it misses, by design

- **A hedge with no counted figure cited.** The other ~50 «no precisan cómo
  se cuenta esa multa» sentences in the committed runs come from
  `ho-iva-en-cero-sin-facturar`, `iva-declaracion-mensual`,
  `ho-hasta-que-dia-tengo-iva`, `desinscripcion-dejar-actividad` and
  `ho-desinscribir-debiendo-declaraciones`. Those answers cite CNPT art. 79
  without the salario base, so they get no derived figure. Art. 79's own text
  gives the 50 % but not the count, so the hedge is honest about the
  fragments it had.
- **A product the answer doesn't write**, or one built from a count the
  condensed question doesn't carry. The route passes no question, so
  `readerCase` is absent from its checks. The two lanes, `answer-replay` and
  this backtest run it.

## Why one gates and the other reports

**#547 gates.** It is the same failure #500 gates on: an absence claim the
judges can't see, because they read the same fragments the model did. Here
the contradicting evidence is stronger than #500's index lookup, since it is
a figure the answer itself cites. It was precise on 58 of 58, and it reads
zero on every answer main's prompt has written (round 2's 6 target draws, its
27-row Tier 1 guard and re-asks, and #556's lane), so it reddens no current
lane.

Scored under it, #512's lane 2 would have read groundedness 70 instead of 73.
Its `multa-iva-no-declarado`, `inscripcion-tardia-sancion` and
`ho-rebajar-multa-si-pago-ya` were judge passes with the hedge. Lane 1 is
unchanged, because its `multa-iva-no-declarado` already failed. Both lanes ran
the prompt #556 replaced, and #556's lane on the current prompt read 73/74
with no hedge, so the baseline (73) stands.

**#546 reports.** Its 11 of 11 is an in-sample read. The tope rule was
tightened on the very sentences it is scored on, and the product rule has one
hit in 2,149 answers. The line between stating a tope and applying it to the
reader is also a reading, not a lookup. That is the typo heuristic's position
(reported, never gated), and a lane that reads a reader's-case slip on
main's prompt is the evidence to gate it later.
