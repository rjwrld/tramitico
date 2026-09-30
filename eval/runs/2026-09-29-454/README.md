# Citation placement on Sonnet 5.5, 2026-09-29 (#454, #458)

The evidence for #454 (a list's lead-in cited, its bullets not) and #458 (a
repeated derived figure without its markers). Every run is `claude-sonnet-5-5`
at `ANSWER_EFFORT=low`, with the judge `claude-sonnet-4-5`. Owner-approved, about US$12 in
all: four Tier 1 replays at about US$2.70 each, plus the abstention lane at about US$1.

The replays re-answer the 27 Tier 1 rows of the
[2026-09-29 full lane](../2026-09-29-451/low/)'s groundedness transcript
from its own chunk lists (`pnpm answer-replay … --tier=1`, both judges). They
do not retrieve. That transcript was written with #451's closing note, which
was later dropped, so each branch replay is read against a **control**: main's
unchanged prompt, replayed on the same rows. Replay noise is about ±1 requirement.

| File                                              | Prompt                                     | What it is                                                                                                  |
| ------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `replay/control.log` · `…T173641Z.jsonl`          | main, 4af5489 (run from the main checkout) | The control.                                                                                                |
| `replay/r1.log` · `…T181109Z.jsonl`               | 9ce46e2                                    | Rule 2: each bullet and table row cites itself; a lead-in's marker does not cover them. Also #458's clause. |
| `replay/r2.log` · `…T184048Z.jsonl`               | 5970e9e                                    | + the marker goes before the period that closes its sentence.                                               |
| `replay/r3.log` · `…T185215Z.jsonl`               | c1a789d (shipped)                          | + a marker backs only its own sentence, not the one before, even from the same document.                    |
| `abstention/abstention.log` · `abstention-…jsonl` | c1a789d                                    | The abstention lane (9 cases, full production path, retrieval knobs at their defaults).                     |

## Tier 1 replays

| Run      | Tier 1 requirements | Grounded    | Bullet lines | Bullets with no marker | Lines with the marker after the period | «Present but uncited» literals | Derived figures incompletely cited |
| -------- | ------------------- | ----------- | ------------ | ---------------------- | -------------------------------------- | ------------------------------ | ---------------------------------- |
| recorded | 77 / 116            | 25 / 27     | 112          | 24                     | 0                                      | `ho-rebajar-multa-si-pago-ya`  | 1 (`ho-desde-cuanta-plata-caja`)   |
| control  | 70 / 116            | 26 / 27     | 124          | 41                     | 0                                      | `ho-rebajar-multa-si-pago-ya`  | 0                                  |
| r1       | 71 / 116            | 25 / 27     | 189          | 0                      | 28                                     | `ho-minimo-renta-2026`         | 0                                  |
| r2       | 70 / 116            | 27 / 27     | 177          | 0                      | 0                                      | `ho-rebajar-multa-si-pago-ya`  | 0                                  |
| r3       | **72 / 116**        | **27 / 27** | 171          | **0**                  | **0**                                  | **none**                       | 1 (`multa-iva-no-declarado`)       |

Every check reads a citation per sentence, and a sentence ends at its period:
the literal check, the abstention figure gate and the runtime's
derived-figure check all work this way. Each step fixed one way of breaking that:

- **r1**: every bullet now carries a marker (0 of 189 without one, against 41 of
  124 in the control), and `ho-rebajar-multa-si-pago-ya`'s «75 %» is cited.
  But 5.5 moved the marker past the period on 28 lines of three answers,
  «- Las rentas de hasta ¢6.244.000,00 anuales no están sujetas al impuesto.
  [1][2]». No earlier transcript does this. It cites nothing, and it cost
  `ho-minimo-renta-2026` its «¢6.244.000» literal.
- **r2**: markers go back before the period. `ho-rebajar-multa-si-pago-ya`
  returned to the recorded shape: a two-sentence bullet with «75%» in the
  first sentence and [1] only on the second.
- **r3**: saying that a marker backs only its own sentence clears it. No
  literal is present but uncited, groundedness is 27/27, and Tier 1 is 72
  (control 70).

## Abstention lane (c1a789d)

9/9 correct abstentions and **zero invented figures**. Both assertions are
green. On the full lane, `ho-abs-calculo-personalizado` tripped the figure gate with an uncited
«75%» bullet under «Sobre el pago, los documentos dicen lo siguiente [6]:».
It now writes «- … El 75% del monto del pago a cuenta se divide en tres cuotas
iguales, … [6].»

## #458: not shown fixed

The derived-figure block now says every mention counts, including a repeat,
a parenthetical or a comparison, and that the markers go after the figure.
It offers the figure's label without the amount as the alternative. The three
T1-F rows and `ho-desde-cuanta-plata-caja` are green on all four replays. But
the recorded repeat on `ho-desde-cuanta-plata-caja`, «la referencia es la de IVM
(¢324.590).», did not reproduce in any of them, the control included. So the
replays cannot tell the fix from noise. r3 then showed the same shape on another row:
`multa-iva-no-declarado` writes «La cifra de ¢231.100 es la que corresponde a
cada declaración omitida, …» with no marker, after citing it correctly two
sentences earlier. The article 78 and 79 figures share that value, so both
count as incompletely cited.

The logs' paths to the checkouts are replaced with `<worktree>` and
`<main checkout>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks. These are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
