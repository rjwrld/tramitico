# Wave E's full lane, 2026-10-09 (#497)

The one full lane map #497's Wave E called for, after its six PRs landed. It is
one `pnpm test:eval` on main at 9817c6e, with a three-case smoke first. The
setup is Wave D's: `claude-sonnet-5-5` at `ANSWER_EFFORT=low` (production's
value), judge `claude-sonnet-4-5`, and every other knob at its code default,
which is production's. That now includes `STEP_PINS=2` (#576). The shared
local stack held the 873-chunk corpus, and the census read 278/278 targets
satisfiable.

Main at that commit carries, beyond Wave D's lane (cdef9d6): #574 (`/api/health`,
#553), #575 (#570's detector, the all-targets count, the robustness notes),
#573 (#571's ops/docs hygiene, closes #552), #576 (`pin1` appends two step
picks, #561), #577 (a figure's sentence carries its own marker, and a date is
compared only for the plazo asked, #572) and #578 (two step-catalogue sentences,
#562).

| File                                          | What it is                                                                                     |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `smoke-groundedness-…T025025Z.log` · `smoke/` | The three-case smoke: 3/3 grounded, no false absence claim, Tier 1 7/11.                       |
| `lane-…T025135Z.log` · `lane/`                | The lane, 1683 s: the groundedness (101 rows, no re-ask) and abstention (15 rows) transcripts. |

The run went from the main checkout, so the logs' paths to it read
`<main-checkout>`. Nothing else is edited. The transcripts are also in the main
checkout's `eval/transcripts/2026-10-09-497-wave-e/`.

**It ran to the end.** No stall, no 429, 5xx or overloaded response, no
timeout, no `unknown knob` line, and no rerank reading lost (0 of 43 in
abstention, 589 in hit-rate, 589 in groundedness). vitest: 2 failed | 38
passed | 1 skipped, in 2 failed | 6 passed files. The two failures are the
groundedness lane's false-absence zero and the abstention figure gate, below.

## Smoke

`renta-plazo-followup`, `ho-ademas-tengo-salario` and
`inscripcion-tardia-sancion` (one per Wave E change: #572's date clause,
#561's second step pin, #562's T1-I sentence): 3/3 grounded, 0 false absence
claims, Tier 1 7/11.

## Gates

| Gate                                           | Wave D (3455dd5) | This lane    | Read                                                                         |
| ---------------------------------------------- | ---------------- | ------------ | ---------------------------------------------------------------------------- |
| Groundedness, judges' first verdict (#474)     | 71/74            | **73/74**    | green (baseline 73, fails ≤ 68); fails `factura-primera-cabys` (inference)   |
| Blocking cases, 2 of 3 answers (#474)          | green            | **green**    | no blocking case failed its first verdict; 0 re-asked                        |
| False corpus-absence claims (#500, #547)       | 0 · 0            | **1** · 0    | **red** in groundedness: `rb-seguimiento-le-cobro-iva`, «salario base», #579 |
| Tier 1 requirements stated                     | 88/116           | **92/116**   | green (baseline 78, fails ≤ 73); **not ratcheted**, owner decision           |
| Tier 1 cases fully adequate (reported)         | 10/27            | 13/27        | reported, not gated                                                          |
| Tier 2 adequate ≥ 84%                          | 13/14            | **12/14**    | green (85.7 %); fails `ho-t2-constancia-al-dia`, `ho-t2-payoneer`            |
| Citation invariant                             | 0                | 0            | green                                                                        |
| Derived figures completely cited; F1 both BMCs | green            | green        | green                                                                        |
| Abstention ≥ 90%                               | 15/15            | **14/15**    | green; fails `ho-abs-calculo-personalizado` (3/3 judges)                     |
| Abstention invents no figure while declining   | red (1)          | **red (1)**  | `ho-abs-devs-exentos-renta`, «13%» again, #580                               |
| `ho-abs-iva-2027` requirement (#502)           | 1/1              | **1/1**      | green                                                                        |
| Hit-rate ≥ 94%                                 | 72/74            | **73/74**    | green (98.6 %); misses `ho-t2-credito-iva-compras` (not in the pool)         |
| All expected targets reached (#570, reported)  | 48/74            | 49/74        | reported; robustness block 14/27                                             |
| Robustness block, hit (#502)                   | 26/27            | **26/27**    | green (baseline 27, fails ≤ 24); misses `rb-tilde-inscribirme-afuera`        |
| Robustness block, grounded                     | 26/27            | 25/27        | fails `rb-corto-cuanto-es-iva` (inference) and `rb-seguimiento-le-cobro-iva` |
| Robustness block, adequate · requirements      | 0/7 · 27/37      | 4/7 · 31/37  | reported                                                                     |
| Conflicting sources, amending law, census      | green            | green        | census 278/278                                                               |
| vitest                                         | 1 failed         | **2 failed** | the two zero gates above                                                     |

### Tier 1: 92/116, two lanes over the baseline

92 is 14 over #512's baseline of 78 and 4 over Wave D's 88, the ±4 that two
identical lanes differ by (#457). It is not ratcheted: the baseline stays 78
until the owner decides. The lower of the two Wave D/E lanes is 88. The misses
are still the where-and-how steps: TRIBU-CR's desinscription path, the
CCSS's payment date by surname, TRIBU-CR as the renta channel, and the
period of the renta (`ho-minimo-renta-2026`, #562's dropped row 20).

### The reds

**`rb-seguimiento-le-cobro-iva`, false absence (#579).** «Los documentos no
traen … el monto vigente del salario base.» The set held `cnpt` · Artículo 79
(the multa of 50 % of a salario base, cited [10]) and not `salario-base-2026`.
Wave D's set for the case had no `cnpt` 79. Here it sits past the top 8, at
position 10, which fits #561's second step pin (T1-D reaches `cnpt` 79). The
transcript doesn't record which pin appended it, so the cause is likely, not
proven. The judges passed the answer.

**`ho-abs-devs-exentos-renta`, «13%» (#580).** The same slip Wave D's owner
accepted, on the same case: «los servicios de desarrollo de software tienen
IVA del 13% según CABYS. Por ejemplo, … [1].» The 13 % is `cabys-dev`'s, cited
one sentence later. #572's clause fixed it 3/3 on fixed chunks and didn't hold
in the live lane. Per Wave D's decision, a second flag makes it a pattern: #580.

Both are zero gates, so the lane is red on two counts. Neither is re-run here:
that is the owner's call.

### Absence openings (reported, not gated)

- Groundedness, 9/101: `factura-electronica-v44`, `factura-primera-cabys`,
  `ho-cabys-paginas-web`, `ho-desinscribir-debiendo-declaraciones`,
  `ho-t2-retencion-tarjetas`, `ho-t2-constancia-al-dia`, `ho-t2-payoneer`,
  `rb-pill-primera-factura`, `rb-tilde-primera-fatura`.
- Abstention, 10/15.

## Cost

There is no console figure. The estimate is Wave D's lane, the same
configuration and row count.

| Step                                                     | ≈US$       |
| -------------------------------------------------------- | ---------- |
| Smoke (3 answers, judges, rewrites, rerank)              | 0.20       |
| Lane: answers, judges, adequacy and label judges         | 8.30       |
| Lane: abstention, fixtures, embeddings, rerank, rewrites | 2.10       |
| **Total**                                                | **≈10.60** |

The groundedness rows embed the text of the retrieved chunks, which are excerpts
of official public documents of the Government of Costa Rica (Hacienda, CCSS,
SINALEVI, BCCR). Those excerpts are outside the repository's Apache-2.0 license;
see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
The answers are model output about public law and contain no user data.
