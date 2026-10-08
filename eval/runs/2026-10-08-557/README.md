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
