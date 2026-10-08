# Three answer-prompt fixes, 2026-10-08 (#546, #547, #550)

Fixed-chunk replays of #512's final lanes (`runs/2026-10-08-final/`), on
main's prompt (the control) and two rounds of prompt changes. Setup is
#512's: `claude-sonnet-5-5` at `ANSWER_EFFORT=low`, judge
`claude-sonnet-4-5`, every other knob at its code default. The replays answer
on the recorded chunks with today's date (2026-10-08, the lanes' own), so
only the prompt moves.

**The replay set**, the same for the control and each round:

- `targets-d{1,2,3}-….log`: `pnpm answer-replay` on lane 1's rows of
  `multa-iva-no-declarado` (#547; lane 1's red), `rb-seguimiento-de-cuanto-multa`
  (#546) and `iva-tarifa-general` (#550's check that a rate case keeps
  passing), three draws.
- `abstention-d{1,2,3}-….log`: `ho-abs-iva-2027` (#550) through the scoped
  abstention lane (`EVAL_CASES=ho-abs-iva-2027`, live retrieval), three
  draws. A scoped lane fails its gates by design («a subset run is a
  transcript read»), so each log ends red. The reads are the `abstention:` and
  `abstention requirements (#502):` lines.
- `tier1-….log`: `pnpm answer-replay --tier=1` on lane 2's 27 Tier 1 rows,
  the regression guard. A round ran it only once its targets passed.

The control ran from the main checkout at b8d8667, one commit behind
origin/main (8caecc5). The two differ only in eval gate constants, not in the
prompt, the pipeline or `answer-replay`. The rounds ran from this worktree.
Paths in the logs read `<worktree>` and `<main-checkout>`. The transcripts are
also in the main checkout's `eval/transcripts/2026-10-08-546-547-550/`.

**Pass bar** (set before the control): each target case passes on 2 of 3
draws, Tier 1 is not more than 4 below the control, no new false absence
claim, and no new judge failure on the Tier 1 rows. The judges pass every
target answer that breaks rule 3 or makes the #547 hedge, so the target
verdicts below are a human read of each answer against its issue. The judge's
verdict is given beside it.

## The prompt changes

Round 1, all in `ANSWER_SYSTEM_PROMPT`:

- Rule 3, #550: a stated figure names the artículo and norma its document
  gives, in its header or its text, also when it is the current figure given
  in place of one no source can give.
- Rule 3, #546: «no multiplique un monto por su número de hijos **ni por los
  meses que lleva sin cumplir** … **ni diga si su caso ya llegó a un tope o lo
  supera**».
- Rule 7, #547: the absence claims it forbids now include «que no dicen cómo
  se cuenta o a qué se aplica una regla, como cuántas veces se cobra una
  multa», pointing to rule 9 for what to say instead.

Round 2 kept those and added two clauses for #547:

- Rule 9's derived-figure branch (state the count with the label's words and
  «en principio»): «… sin agregar que los documentos no dicen cómo se cuenta:
  la etiqueta lo dice».
- `formatDerivedFigures`: «Lo que dice la etiqueta de una cifra sobre cómo se
  cuenta («por cada …», «por mes o fracción») es parte de lo que dicen las
  fuentes: no escriba que no lo dicen.»

## Control vs rounds

| Case (issue)                                          | Control (main)                | Round 1              | Round 2                               |
| ----------------------------------------------------- | ----------------------------- | -------------------- | ------------------------------------- |
| `multa-iva-no-declarado` (#547), no count hedge       | **0/3** (judges 3/3 pass)     | **1/3** (judges 1/3) | **2/3** (judges 3/3)                  |
| `rb-seguimiento-de-cuanto-multa` (#546), no cap read  | **1/3**                       | **3/3**              | **3/3**                               |
| `iva-tarifa-general` (#550), grounded · names art. 10 | 3/3 · 0/3                     | 3/3 · 3/3            | 3/3 · 3/3                             |
| `ho-abs-iva-2027` (#550), declines                    | 3/3                           | not run              | 2/3                                   |
| `ho-abs-iva-2027`, requirement on the claim           | **1/3** (literal 2/3)         | not run              | **3/3**                               |
| Tier 1 guard, requirements / 116                      | **84**                        | not run              | **81** (−3)                           |
| Tier 1 guard, grounded / 27                           | 26 (`multa-iva-no-declarado`) | not run              | 26 (`ho-800-mil-que-porcentaje-caja`) |
| False absence claims (#500)                           | 0                             | 0                    | 0                                     |

Round 1 stopped at its targets: `multa-iva-no-declarado` wrote the label's
count with «en principio» and then, in the next sentence, «Los documentos no
dicen cuántas veces se aplica esa multa cuando se omiten varios períodos»
(d1) and «Los documentos no dicen si esa multa se cobra una vez por cada
declaración omitida o de otra forma» (d3). Now the judges failed both. So the
rule 7 clause alone moved the hedge from rule 7's ground to rule 9's
derived-figure branch, and round 2 closed the branch where the move happens.

### Per case

- **#547, `multa-iva-no-declarado`.** Control: «Las fuentes no dicen cuántas
  veces se aplica esa multa si se omiten varias declaraciones» (d1), «Las
  fuentes no dicen cómo se cuenta la multa cuando se omiten varias
  declaraciones» (d2), and «[el Código] no dice si se aplica una vez por cada
  declaración o por cada período» (d3). The judges passed all three. Round 2:
  d1 «en principio se aplica por cada declaración omitida [1][11]» and d3 «en
  principio, la cifra derivada es "por cada declaración tributaria omitida"
  [1][11]», with no hedge. d2 states the label, then «Las fuentes no dicen
  **más** sobre cómo se cuenta la multa cuando se omiten varias declaraciones
  seguidas». That is softer, since it no longer denies the per-declaration
  count, but it is still a claim about the sources, so it counts as a miss.
  Lane 2's row in the Tier 1 guard is a fourth draw. The judges failed it on
  the control and passed it on round 2.
- **#546, `rb-seguimiento-de-cuanto-multa`.** Control: «Para su caso, un año
  sin registrarse supera los meses necesarios para llegar al tope» (d1), and
  «Para un año sin registrarse, el tope es el límite de lo que puede resultar»
  (d3). Rounds 1 and 2: the rule and its tope, with the count of months left
  to the reader or Hacienda in every draw («la cuenta de los meses de su caso
  la hace usted o Hacienda»). Round 1 d1/d2 phrase it as «no calculo su
  caso», which is first person but compliant.
- **#550, `ho-abs-iva-2027`.** Control: d2 names art. 10 in the 13 % sentence
  («conforme al artículo 10 de la Ley [1]»), d1 only in the ICT transitorio
  sentence (#507's pattern: the literal passes, the claim doesn't), and d3 not
  at all. Round 2, all three: «La tarifa general … es del 13% …, según el
  artículo 10 de la Ley del Impuesto sobre el Valor Agregado [2]». Round 2 d3's
  decline was failed by the judges, 3/3: «provided the current IVA rates in
  detail instead of simply declining». The answer opens with the decline,
  lists the reduced rates and routes to Hacienda. Control d1 and both #512
  lanes listed the reduced rates in the same shape and passed, so this reads
  as the judge's variance on an edge #512 already recorded, not a change the
  prompt made.
- **#550, `iva-tarifa-general`.** Grounded in every draw. Main's prompt never
  named art. 10, and round 1 and 2 named it in all six draws.

### The Tier 1 guard

Round 2 reads 81 against the control's 84, inside the 4. The per-case moves
are in both logs. The largest is `ho-hacienda-solo-cliente-eeuu` (3 → 1),
which now opens with an absence claim. No false absence claim was made on
either side.

The one new judge failure is `ho-800-mil-que-porcentaje-caja`. The answer
says «Las fuentes no coinciden en el detalle de IVM» between the IVM escala
(9.91 % conjunta) and the ficha técnica's 11.66 % global with 1.75 % Estado
como tal. That is a rule 4 and #179 reading of the IVM escala, and no clause
changed here touches it. The case has failed the judges before (2026-10-02's
full lane, 2026-09-22's medium arm) and passed in about 30 other committed
reads. Re-asked twice on round 2's prompt (`reask-800-mil-d{2,3}-….log`), it
passed both times, so it fails 1 of 3. By #474's rule a blocking case would
not count that as a failure. Read strictly, «no new judge failure» is not met
on the first verdict. Read the way a lane reads it, it is.

## Cost

There is no console figure. The estimate uses #507's measured rate for fixed-chunk
replays (≈US$1.30 for 30 rows, both judges) and #507's scoped-abstention
read (≈US$0.10).

| Step                                                       | Rows | ≈US$      |
| ---------------------------------------------------------- | ---- | --------- |
| Balance check (one-token Haiku call)                       | —    | 0.00      |
| Control: targets ×3, Tier 1 guard                          | 36   | 1.55      |
| Control: `ho-abs-iva-2027` ×3                              | 3    | 0.30      |
| Round 1: targets ×3                                        | 9    | 0.40      |
| Round 2: targets ×3, Tier 1 guard, `ho-800-mil` re-asks ×2 | 38   | 1.65      |
| Round 2: `ho-abs-iva-2027` ×3                              | 3    | 0.30      |
| **Total**                                                  |      | **≈4.20** |

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
