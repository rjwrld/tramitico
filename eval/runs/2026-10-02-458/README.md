# A derived figure's later mentions, 2026-10-02 (#458)

The evidence for #458's second pass. #463 shipped the block's «every mention
counts» clause, and its r3 replay then showed one more shape on
`multa-iva-no-declarado`: «La cifra de ¢231.100 es la que corresponde a cada
declaración omitida, y la operación para sus tres meses la debe confirmar con
Hacienda.», with no marker, two sentences after the figure was cited correctly.
That is the sentence rule 9 puts at the end, beside the referral, where nothing
else is a claim to cite.

This branch changes the derived-figure block two ways. That closing sentence
is named as a mention too. The label becomes the default: the amount is given
once with its markers, and later mentions use the figure's label without the
amount. A repeated amount carries all its markers again.

Every run is `claude-sonnet-5-5` at `ANSWER_EFFORT=low`. The replays re-answer
rows of the [2026-09-29 full lane](../2026-09-29-451/low/)'s groundedness
transcript from their own chunk lists (`pnpm answer-replay … --cases=…`). They
do not retrieve. The control runs main's prompt (567afb3, which carries #463)
from the main checkout. The branch runs 05cd85b. About US$1.60 in all,
coordinator-approved inside the owner's budget.

| File                                        | Arm     | What it is                                                                                        |
| ------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------- |
| `replay/control.log` · `…T171502Z.jsonl`    | control | The three T1-F rows, `ho-desde-cuanta-plata-caja` and `multa-iva-no-declarado`. Both judges.      |
| `replay/branch.log` · `…T171701Z.jsonl`     | branch  | The same five rows.                                                                               |
| `replay/extra-{control,branch}-{1,2,3}.log` | both    | Three more pairs, run alternately, on the two rows that showed the repeat. No groundedness judge. |

## Five-row replay

| Arm     | Grounded | Requirements stated | Citation invariant | Derived figures incompletely cited |
| ------- | -------- | ------------------- | ------------------ | ---------------------------------- |
| control | 5 / 5    | 20 / 23             | 0                  | **0**                              |
| branch  | 5 / 5    | 20 / 23             | 0                  | **0**                              |

The recorded transcript stated 21 of 23. Each arm lost one requirement on a
different row. The control lost a step on `ho-tambien-asegurado-por-patrono`.
The branch lost «Cómo se declara el ingreso de referencia y dónde se paga la
cuota» on `ho-desde-cuanta-plata-caja`, which it stated on all three extra
replays. Both are within replay noise, about ±1 requirement.

## Repeat rate on the two rows

Four samples per arm per row: the five-row replay plus three extras.

| Row                          | Arm     | Incompletely cited | Amount repeated in a later sentence | Requirements missing, per sample |
| ---------------------------- | ------- | ------------------ | ----------------------------------- | -------------------------------- |
| `multa-iva-no-declarado`     | control | 0 / 4              | 0 / 4                               | 2, 1, 2, 0                       |
| `multa-iva-no-declarado`     | branch  | 0 / 4              | 1 / 4, cited                        | 2, 2, 2, 2                       |
| `ho-desde-cuanta-plata-caja` | control | 0 / 4              | 0 / 4                               | 0, 0, 0, 0                       |
| `ho-desde-cuanta-plata-caja` | branch  | 0 / 4              | 0 / 4                               | 1, 0, 0, 0                       |

The one repeat is `extra-branch-1`. It gives ¢231.100 twice, once for
article 79 and once for article 78, each with its own markers. These are two
figures that share a value, so it is not the failing shape.

`multa-iva-no-declarado`'s two misses are the ones the full lanes already
record (#358 row 8). The control's 1 and 0 are the spread of that row, not a
loss on the branch.

## What this does and does not show

#458's acceptance holds on the branch. The derived-figure gate is green on
every replay of the T1-F rows, `ho-desde-cuanta-plata-caja` and
`multa-iva-no-declarado`. The F1 test (#312) still passes, and nothing is lost
beyond noise against the control.

It does not show that the change moves the rate. The control was green too, on
all 8 samples of the two rows. Neither recorded shape reproduced on main's
prompt: «la referencia es la de IVM (¢324.590).» from 2026-09-29 and
«La cifra de ¢231.100 …» from #463's r3. Counting the 2026-09-28 and
2026-09-29 lanes, #454's four replays and these four control samples,
`ho-desde-cuanta-plata-caja` shows it in 2 of 10 answers, both on prompts
before #463. `multa-iva-no-declarado` shows it in 1 of 10, on #463's prompt.
Measuring the rate would take tens of samples per arm. If it shows up again in production,
the runtime still refuses the draft and spends its one retry.

The logs' paths to the checkouts are replaced with `<worktree>` and
`<main checkout>`. Nothing else is edited.

The groundedness rows embed the text of the retrieved chunks. These are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
