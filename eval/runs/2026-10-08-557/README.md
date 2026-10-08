# The prompt's words and a first-person refusal, out of the answer, 2026-10-08 (#557)

Fixed-chunk replays, a control on main's prompt (ddfb9a1, #556 merged) and up
to three rounds of prompt changes. Setup is #556's
([`runs/2026-10-08-546-547-550/`](../2026-10-08-546-547-550/README.md)):
`claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge `claude-sonnet-4-5`, every
other knob at its code default. The replays answer on the recorded chunks with
today's date (2026-10-08), so only the prompt moves. The control runs from the
main checkout, the rounds from this worktree. Paths in the logs read
`<worktree>` and `<main-checkout>`. The transcripts are in the main checkout's
`eval/transcripts/2026-10-08-557/`.

## What leaks, before any paid call

`leak-check.sh` (this directory, jq only, free) prints every sentence of an
answer that writes the derived-figure block's words («cifra derivada»,
«etiqueta», «marcador») or a first-person refusal («no calculo», «yo no»,
«no puedo calcular», «no hago», …). A hit is a lead; the reads below are by
hand.

```sh
bash eval/runs/2026-10-08-557/leak-check.sh <transcript.jsonl>...
```

On the committed lanes and #556's replays it found:

| Transcript                                 | Answers with a hit | Vocabulary                                                                                         | First-person refusal to compute                                                                                                                                                                                                                                                                            |
| ------------------------------------------ | ------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| #512 lane 1 (prompt before #556)           | 6/101              | `multa-iva-no-declarado`, `ho-minimo-caja-independiente-2026`, `ho-rebajar-multa-si-pago-ya`       | `renta-persona-fisica-deduccion`, `iva-ajuste-bien-de-capital`, `rb-corto-cuanto-pago-caja`                                                                                                                                                                                                                |
| #512 lane 2 (prompt before #556)           | 9/101              | `ho-minimo-caja-independiente-2026`, `ho-rebajar-multa-si-pago-ya`, `rb-pill-asegurarme-gano-poco` | `ccss-cuanto-pago-base`, `renta-persona-fisica-deduccion`, `iva-ajuste-bien-de-capital`, `ho-minimo-caja-independiente-2026`, `rb-pill-impuesto-renta`, `rb-corto-cuanto-pago-caja`, `rb-seguimiento-cuanto-me-toca`                                                                                       |
| #556's lane (**main's prompt**), 77 rows   | 7/77               | `multa-iva-no-declarado`                                                                           | `multa-iva-no-declarado` («yo no hago esa liquidación»), `iva-ajuste-bien-de-capital` («no puedo calcularla por usted»), `rb-pill-cuanto-pago-independiente`, `ho-tambien-asegurado-por-patrono` («la operación con su ingreso no la hago aquí»), `renta-plazo-followup` (a date: «así que no la calculo») |
| #556's round 2 replays (**main's prompt**) | —                  | `multa-iva-no-declarado` 3/4 draws, `rb-seguimiento-de-cuanto-multa` 1/3                           | `multa-iva-no-declarado` 3/4, `rb-seguimiento-de-cuanto-multa` 3/3                                                                                                                                                                                                                                         |
| #512/#556 abstention lanes                 | 1/15 each          | —                                                                                                  | `ho-abs-calculo-personalizado` («No puedo calcular su impuesto exacto»), 3/3 lanes                                                                                                                                                                                                                         |

So the leak predates #556: «la cifra derivada es ¢231.100» is on #512's lanes
and #556's own control, and the first-person refusal is on about one answer in
twelve of every lane. #556's rule 9 clause («la etiqueta lo dice») added
«etiqueta». Two other first-person sentences on #556's lane refuse no
computation (`ho-cabys-paginas-web` «no puedo darle ese número»,
`ho-desinscribir-debiendo-declaraciones` «no puedo darle un sí o un no»).
They are reported, not gated: both are Tier 1, so the guard reads them.

## The replay set

The same for the control and each round:

- `targets-d{1,2,3}-….log`: `pnpm answer-replay` on #556's lane rows of
  `multa-iva-no-declarado`, `iva-ajuste-bien-de-capital`,
  `rb-pill-cuanto-pago-independiente`, `ho-tambien-asegurado-por-patrono` and
  `renta-plazo-followup`, three draws. Every leaking case on the lane whose
  leak refuses a computation or names the block.
- `seguimiento-d{1,2,3}-….log`: #512's lane 1 row of
  `rb-seguimiento-de-cuanto-multa`, three draws. #556's lane has no row of it
  (the crash cut the robustness block), and #556 replayed this one.
- `tier1-….log`: `pnpm answer-replay --tier=1` on #556's lane, 27 rows, the
  regression guard. A round runs it only once its targets pass.
  `multa-iva-no-declarado` and `ho-tambien-asegurado-por-patrono` are Tier 1,
  so the guard is a fourth draw of each.
- Rounds only: `ho-abs-calculo-personalizado` ×3 through the scoped
  abstention lane (`EVAL_CASES=ho-abs-calculo-personalizado`, live
  retrieval). A scoped lane ends red by design; the reads are its
  `abstention:` line and the answer. Its control is the three committed
  lanes, first person 3/3.

The smoke is the control's first draw of three targets.

## Pass bar

Set before the control. An answer **passes** when, read by hand, with
`leak-check.sh`'s hits as leads:

1. it writes none of «cifra derivada», «etiqueta», «marcador»;
2. it phrases no refusal to compute in the first person — what the answer
   doesn't do is a remit (who does it, where), per rules 3, 6 and 6c;
3. #556's fixes still hold: no #547 hedge (that the sources don't say how a
   fine counts, when a derived figure's label says it), no #546 slip (a figure
   multiplied by the reader's months, hijos or income, or «su caso ya llegó al
   tope»), and it still leaves the operation to the reader or the institution
   rather than doing it.

#558's detectors (#546/#547) had not merged when this bar was set; if they
merge before a read, that read runs them too.

The change **passes** when:

- each target case passes on **≥ 2 of 3** draws;
- `ho-abs-calculo-personalizado` declines on 3/3 and passes 1–2 on ≥ 2 of 3;
- the Tier 1 guard's requirements stated are **not more than 4 below the
  control's**;
- **no new false absence claim** (#500; `answer-replay` prints them recorded
  → replayed);
- **no new Tier 1 judge failure**: a row the judges pass on the control and
  fail on a round is re-asked twice (`--cases=<id>`), and counts as a failure
  on 2 of 3, #474's rule, the way #556 read `ho-800-mil-que-porcentaje-caja`.

At most three rounds. If round 3 misses the bar, the run stops and reports;
no tuning toward a number (ADR 0023).

## The control, on main's prompt

From the main checkout at ddfb9a1 (= origin/main, clean), `control/`. The
smoke was the first draw of three targets (`targets-d1a-….log`); no row
errored and no log carries `config: unknown knob value`. Transcripts by draw:
`224820` d1a, `224908` d1b, `225037` d2, `225157` d3, `225219`/`225241`/`225302`
seguimiento d1–d3, `230311` the Tier 1 guard.

| Target                              | d1                                                      | d2                                             | d3                                                   | Passes  | Judges |
| ----------------------------------- | ------------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- | ------- | ------ |
| `multa-iva-no-declarado`            | ✗ «no multiplico la cifra por los meses»                | ✗ «No la multiplico por sus tres meses»        | ✗ «Esa etiqueta no extiende la cifra…»               | **0/3** | 1/3    |
| `iva-ajuste-bien-de-capital`        | ✓ «debe hacerlos usted o su contador»                   | ✓ «el cálculo lo debe hacer usted o su asesor» | ✓ «debe calcularlas usted o su contador»             | 3/3     | 3/3    |
| `rb-pill-cuanto-pago-independiente` | ✗ «Esta respuesta no calcula su cuota»                  | ✓ «esa operación le toca a usted o a la CCSS»  | ✓                                                    | 2/3     | 3/3    |
| `ho-tambien-asegurado-por-patrono`  | ✓                                                       | ✗ «porque no opero la cifra con sus datos»     | ✗ «Las fuentes no me permiten hacer la liquidación…» | **1/3** | 2/3    |
| `renta-plazo-followup`              | ✗ «no traen la fecha exacta…, por lo que no la calculo» | ✓                                              | ✗ «no la calculo por mi cuenta»                      | **1/3** | 2/3    |
| `rb-seguimiento-de-cuanto-multa`    | ✗ «Cuánto le corresponde en su caso no lo calculo»      | ✓ «le corresponde determinar a Hacienda»       | ✓ «queda a Hacienda»                                 | 2/3     | 3/3    |

The Tier 1 guard's row is a fourth draw of two targets:
`multa-iva-no-declarado` ✗ («la cifra derivada es: …», «No digo cuántas veces
se aplica a sus tres meses»; judges fail) and `ho-tambien-asegurado-por-patrono`
✓. `rb-pill-cuanto-pago-independiente` d1 counts as a miss though it is not in
the first person: «Esta respuesta no calcula su cuota» describes what the
answer won't do instead of saying who does it (bar item 2, the issue's «without
describing what it won't do»).

#556's fixes held on every control draw: no figure multiplied by the reader's
months, no «ya llegó al tope» (`rb-seguimiento` d2 leaves «si el tope ya se
alcanzó» to Hacienda), and no «las fuentes no dicen cómo se cuenta». The
nearest is `multa-iva-no-declarado` d1/d2: «cuántas veces se aplica esa multa
debe confirmarlo con Hacienda» beside the label's «por cada declaración», a
remit, not a denial.

The judge failures on targets are not the leak: `renta-plazo-followup` d1
wrote «La fecha de setiembre de 2026 ya pasó»; `ho-tambien` d2 gave IVM 9.91 %
beside the ficha's 11.66 % (the `ho-800-mil` reading #556 recorded);
`multa-iva-no-declarado` d2/d3 were failed on the first-person sentence and on
«Esa etiqueta no extiende…».

**Tier 1 guard (control): 84/116 requirements stated** (the lane recorded 83),
grounded 24/27, the failures `ccss-ventana-prescripcion-24-meses`,
`multa-iva-no-declarado` and `ho-rebajar-25-sin-facturas`. False absence
claims 0 → 0; absence openings 4 → 2 (`ho-cabys-paginas-web`,
`ho-desinscribir-debiendo-declaraciones`, both also first person but refusing
no computation).

## The prompt change (round 1)

- Rule 7, after «nunca hable de extractos, pasajes ni textos numerados»: «Tampoco
  escriba las palabras con que se le entregan las cifras calculadas —«cifra
  derivada», «etiqueta», «marcador»—: diga la cifra, cómo se cuenta y de qué
  artículo sale («la multa por cada declaración omitida, según el artículo 79,
  es de ¢… [n]»).» The example carries no amount: the system prompt outlives a
  year's salario base (#505).
- Rule 8, where the voice is set: «Lo que la respuesta no hace —una operación
  o una liquidación con los datos de la persona— no lo diga en primera persona
  («no calculo su caso», «no le calculo un total»): diga quién la hace, como
  una remisión de la regla 6 («el total de su caso lo determina Hacienda»).»
- `formatDerivedFigures`: «Las palabras de esta lista («cifra derivada»,
  «etiqueta», «marcador») son para usted, no para la persona: no las escriba
  en la respuesta.»

## Round 1

From this worktree, `round1/`. Transcripts by draw: `230629` d1, `230756` d2,
`230910` d3, `230930`/`230949`/`231010` seguimiento d1–d3, `232040` the Tier 1
guard; `abstention-subset-…` the three scoped abstention draws. No row
errored and no log carries `config: unknown knob value`.

| Target                              | d1                                                                  | d2                                                                              | d3                                                      | Passes                 | Judges |
| ----------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------- | ------ |
| `multa-iva-no-declarado`            | ✓ «Cuántas declaraciones suman…, y el total, lo determina Hacienda» | ✗ «Las fuentes no dicen cómo se cuenta…» (#547) and «no puedo darle un total»   | ✓ «el total de su caso lo determina Hacienda»           | 2/3                    | 3/3    |
| `iva-ajuste-bien-de-capital`        | ✓                                                                   | ✓ «el cálculo con sus datos lo hace usted o Hacienda»                           | ✓ «El cálculo con sus cifras lo hace usted, o Hacienda» | 3/3                    | 3/3    |
| `rb-pill-cuanto-pago-independiente` | ✓                                                                   | ✓ «el monto de su caso lo determina la CCSS»                                    | ✓                                                       | 3/3                    | 3/3    |
| `ho-tambien-asegurado-por-patrono`  | ✓ «El monto en colones lo determina la CCSS»                        | ✓                                                                               | ✓                                                       | 3/3                    | 3/3    |
| `renta-plazo-followup`              | ✓ «debe ubicarla con base en esa regla»                             | ✓ (judges fail: «la fecha de setiembre de 2026 ya pasó», the control's d1 slip) | ✗ «así que no la calculo»                               | 2/3                    | 2/3    |
| `rb-seguimiento-de-cuanto-multa`    | ✓ «El total de su caso… lo determina Hacienda»                      | ✓ «lo determina Hacienda; la operación… no la hacen estas fuentes»              | ✓                                                       | 3/3                    | 3/3    |
| `ho-abs-calculo-personalizado`      | ✗ «No puedo darle un total exacto: … la determina Hacienda»         | ✗ «No puedo darle un monto exacto: …»                                           | ✗ «No puedo darle un total exacto, porque…»             | **0/3** (declines 3/3) | —      |

The Tier 1 guard's fourth draws: `multa-iva-no-declarado` ✗ («La suma por sus
tres meses no la hago aquí»), `ho-tambien-asegurado-por-patrono` ✓. No answer
wrote «cifra derivada», «etiqueta» or «marcador» (control: 3 of 22 target
answers). #546 held on every draw: no multiplied figure, no «ya llegó al
tope». Two reads are close calls, counted as passes: `multa` d3 writes «cada
mes sin declarar es una declaración omitida» (the label's count put to the
reader's months, with no number or total), and `rb-seguimiento` d2 ends «la
operación con sus meses no la hacen estas fuentes» after naming Hacienda.

**Tier 1 guard: 86/116** (control 84), grounded 26/27; the one failure,
`ccss-ventana-prescripcion-24-meses`, failed on the control too, so no new
judge failure. False absence claims 0 → 0. Absence openings (reported, not
gated) 5, against the control's 2: `inscripcion-tardia-sancion`,
`ho-hacienda-solo-cliente-eeuu`, `ho-cabys-paginas-web`,
`ho-minimo-caja-independiente-2026`, `ho-desinscribir-debiendo-declaraciones`.

**Round 1 misses the bar** on `ho-abs-calculo-personalizado`: it declines and
now remits to Hacienda in the same sentence, but opens in the first person
every time. Rule 6c's «corríjala o dígalo» is where that opening comes from;
round 1's rule 8 sentence did not reach it.

## Round 2

Round 1's three clauses, plus:

- Rule 6c, after the liquidación sentence: «Ese «dígalo» es la remisión
  misma, no una negativa en primera persona (regla 8): no «No puedo darle un
  total exacto», sino «El monto exacto de su caso lo determina Hacienda».»
- Rule 8's examples add «no la hago aquí», the fourth draw's wording.

## Cost

Estimated at ≈US$0.10 a row (`answer-replay`'s header), and at #556's measured
replay rate (36 rows ≈ US$1.55, ≈US$0.043 a row) beside it.

| Step                                       | Rows | ≈US$ (header rate) | ≈US$ (#556 rate) |
| ------------------------------------------ | ---- | ------------------ | ---------------- |
| Control: smoke (3 targets, d1)             | 3    | 0.30               | 0.13             |
| Control: rest of targets ×3, Tier 1 guard  | 42   | 4.20               | 1.80             |
| Each round: targets ×3                     | 18   | 1.80               | 0.80             |
| Each round: Tier 1 guard                   | 27   | 2.70               | 1.15             |
| Each round: `ho-abs-calculo-personalizado` | 3    | 0.30               | 0.30             |

Spent so far (estimated at #556's rate; there is no console figure, and the
replays' output tokens, 954–1,870 a row, are in line with #556's):

| Step                       | Rows | ≈US$ |
| -------------------------- | ---- | ---- |
| Control smoke              | 3    | 0.13 |
| Control, rest              | 42   | 1.80 |
| Round 1 (a), targets ×3    | 18   | 0.80 |
| Round 1 (b), abstention ×3 | 3    | 0.30 |
| Round 1 (c), Tier 1 guard  | 27   | 1.15 |
| **Total**                  |      | 4.18 |
