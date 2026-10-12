# Carriers #592 made available, and the claims that still miss, 2026-10-10 (#602)

Wave G's lane (`../2026-10-10-497-wave-g/`, main e7d954c) still misses two
Tier 1 claims that #592 (#597, #598) made carriable, and the read-side carrier
maps still named the old source. This record fixes the maps (item 3). It
diagnoses items 1 and 2 and reports item 4. Nothing here changes the prompt,
the pipeline, `eval/dataset.jsonl` or a baseline (ADR 0023).

**Cost.** One `answer-set-probe` over 10 cases with replayed rewrites, so
Voyage was the only provider called and there were no Anthropic calls. The
probe doesn't record usage, so this is a bound. It made 59 rerank readings of
at most 40 chunks each (≈450 tokens per chunk, from the corpus mean of 1479
characters), so at most ≈1.1 M `rerank-2.5-lite` tokens. Add 10 cases'
embeddings. The total is **≤ US$0.03**, and the Voyage dashboard is the exact
figure. SQL is read-only on the shared local stack (894 chunks).

| File                       | What it is                                                                                                     |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `probe.json` · `probe.log` | the probe: 10 cases, rewrites replayed from `../2026-10-09-562/probe-after.json`, 0 of 59 rerank readings lost |
| `read.mjs`                 | free: where each TRIBU-CR carrier sits per case, as fused pool, reranked order and answer set                  |
| `queries.sql`              | the chunk ids, the new quotes' check and what each preámbulo says about ATV                                    |

```
EVAL_CASES=desinscripcion-dejar-actividad,rb-pill-me-salgo,rb-tilde-deje-de-trabajr,ho-rebajar-25-sin-facturas,tribu-cr-declarar-pagar,iva-declaracion-mensual,renta-declaracion-plazo,rb-corto-cuando-declaro-renta,rb-corto-cuando-declaro-iva,ho-iva-en-cero-sin-facturar \
EVAL_REWRITES=eval/runs/2026-10-09-562/probe-after.json PROBE_CASE_MS=3000 \
pnpm answer-set-probe eval/runs/2026-10-10-602/probe.json
node eval/runs/2026-10-10-602/read.mjs
```

Positions below are under the route's configuration (`top8/capoff/pinon`, the
cross-reference and salario base pins on). `pool#` is the fused pool (40),
`order#` the reranked order and `set#` the place in the answer set. «—» means
absent.

## Item 3: the maps, fixed

Rows are #554's table (`../2026-10-08-554/`).

| Row | Case                          | Was                                            | Now                                                                                 |
| --: | ----------------------------- | ---------------------------------------------- | ----------------------------------------------------------------------------------- |
|  16 | `ho-iva-en-cero-sin-facturar` | `tribu-cr-res-0011-2025` Art. 2, `cnpt` 79, 88 | `tribu-cr-res-0033-2025` Art. 1 (`08b0596b`) and Art. 3 (`46dd069c`), `cnpt` 79, 88 |
|  18 | `ho-rebajar-25-sin-facturas`  | `tribu-cr-res-0011-2025` Art. 2                | `tribu-cr-res-0020-2025` Art. 3 (`f8cf1bac`)                                        |

The change lands in `eval/tier1-carriers.json` and
`eval/runs/2026-10-08-554/carriers.json`. In the latter each new carrier has a
quote, and Q2 reads all three true against `public.chunks`. The labels are the
`articulo` values in `public.chunks` and `eval/corpus-index.json`.
`carriers.test.ts` and `tier1-miss-causes.test.ts` stay green.

Row 17 (`ho-hasta-que-dia-tengo-iva`, «what to do if the date passed») also
named `tribu-cr-res-0011-2025` Art. 2. A follow-up moved it the way row 16
moved, to `tribu-cr-res-0033-2025` Art. 1 and Art. 3 beside `cnpt` 88, in
`../2026-10-08-554/carriers.json` only (`eval/tier1-carriers.json` has no row
for it). The same follow-up moved `ho-rebajar-multa-si-pago-ya` in
`eval/tier1-carriers.json` from RES-0011 Art. 2 to RES-0033 Art. 1 and Art. 3:
its carrier is the IVA case's «presentar lo omitido y pagar en TRIBU-CR» step.

## Item 1: the D-140 → ATV rewrite (three cases)

The claim has two halves: **TRIBU-CR** as the place where the desinscripción
is filed, and **ATV** being disabled. They have different carriers and miss
for different reasons.

- **ATV disabled.** Q3 finds four chunks that carry it: `tribu-cr-res-0011-2025`
  Art. 1 (`105f8161`, «se tienen por deshabilitadas … Administración Tributaria
  Virtual (ATV)»), the RES-0020 Preámbulo #1 (`6c8b8695`) and both RES-0033
  Preámbulos (`3ea7f95f`, `619098ba`), the last three in the form «no
  continuará a disposición de los contribuyentes». The RES-0011 Preámbulo #0
  (`9b4bbb77`) names ATV only as the title of a 2015 resolution, and the
  RES-0020 Preámbulo #0 (`f9f122e6`) names it only where ATV was set up.
  Neither carries the claim.
- **TRIBU-CR.** `tribu-cr-faq` Declaraciones del RUT · 31 (`48f2c8ab`), «¿Dónde
  se hace la solicitud para desinscribirse del sistema TRIBU-CR?». It is the
  chunk T1-H's first catalogue sentence reaches.

| Case                             | ATV carriers (any of 4) | RUT · 31                     | Wave G set                     | Class                                                 |
| -------------------------------- | ----------------------- | ---------------------------- | ------------------------------ | ----------------------------------------------------- |
| `desinscripcion-dejar-actividad` | none in the pool        | pool#9 · order#8 · **set#8** | RUT · 31 in (marker 8), no ATV | ATV: **retrieval miss**; TRIBU-CR: **in set, unsaid** |
| `rb-pill-me-salgo`               | none in the pool        | pool#23 · order#17 · —       | neither                        | ATV: **retrieval miss**; TRIBU-CR: **rerank cut**     |
| `rb-tilde-deje-de-trabajr`       | none in the pool        | pool#8 · order#14 · —        | neither                        | ATV: **retrieval miss**; TRIBU-CR: **rerank cut**     |

The probe's set for `desinscripcion-dejar-actividad` is the lane's set, chunk
for chunk (11/11). The lane's answer cites RUT · 31 as [8] for «Mis datos» →
«Solicitar desinscripción» but calls the place «la Oficina Virtual». The same
holds for every `tribu-cr-faq` chunk in the three sets, whose bodies say
«Oficina Virtual» or «OVi». Only their title header and RUT · 31's question
say TRIBU-CR. The two robustness sets differ from the lane's in 2 and 4 chunks
(the lane ran live expansions, the probe replayed #562's). Neither run holds
RUT · 31 for them.

The case is classified by its upstream half: **retrieval miss** for all three.
No chunk that says ATV is disabled enters any of the three pools, so no answer
could state the ATV half. No T1-H catalogue sentence reaches one either.

Options:

- **A. Leave it; the requirement asks for more than retrieval brings.** It
  costs nothing. The three cases keep missing one requirement each, and the
  number stays honest.
- **B. A T1-H catalogue sentence for the ATV half** (for example from
  `tribu-cr-res-0011-2025` Art. 1's wording), with `reaches` updated. This is
  the #304 mechanism: it brings the chunk as a step leg, but it reaches the set
  only if the step pin picks it over T1-H's current two pins, which are
  RUT · 43 and `ley-iva` 27 in this probe. The cost is a probe (cents), plus a
  replay or lane to read the effect. The risk is that the sentence is written
  toward this one requirement.
- **C. Drop the ATV half from the claim** and keep «en la Oficina Virtual de
  TRIBU-CR …». The ATV clause stands in for #592's D-140 clause, and the user
  asked how to leave Hacienda, not about ATV. Whether ATV's end is a Tier 1
  requirement here is the owner's call. #592's rule allows a rewrite only for
  what isn't carried, and this half is carried.
- **TRIBU-CR half, in-set-but-unsaid** (`desinscripcion-dejar-actividad`): the
  carrier sits at set#8, and the answer paraphrases it as «Oficina Virtual».
  The only fix that isn't retrieval is the prompt, which is out of scope (ADR
  0023). On the robustness variants it is a rerank cut (order#14 and order#17
  against a top 8). T1-H's sentence reaches RUT · 31, but the step pin chose
  RUT · 43 there.

## Item 2: `ho-rebajar-25-sin-facturas`

| Carrier                                       | Probe                         | Wave G set |
| --------------------------------------------- | ----------------------------- | ---------- |
| `tribu-cr-res-0020-2025` Art. 3 (the current) | not in the pool               | absent     |
| `tribu-cr-res-0011-2025` Art. 2 (the target)  | pool#21 · order#40 (last) · — | absent     |

Class: **retrieval miss** for the current carrier, and **rerank cut** for the
old target (last of 40, as the lane found: 0/1). The set holds no `tribu-cr-*`
chunk in either run. The question is about the 25 % deduction, so the channel
is a step the reader didn't ask for. Only the catalogue can bring it.

T1-E's third sentence («El Sistema Integrado de Gestión Tributaria TRIBU-CR es
la única plataforma…») reaches `tribu-cr-res-0011-2025` Art. 2. Here the step
pin took T1-E's other two (`ley-renta` ARTICULO 22, `reglamento-renta` 28).
On `rb-corto-cuando-declaro-renta`, the same family pinned Art. 2 into the set
(set#10). So the sentence works, and this case loses it to the two-pin limit.

Options:

- **A. Leave it.** It costs nothing, and one Tier 1 requirement stays missed.
- **B. Re-point T1-E's sentence at RES-0020 Art. 3's wording** («…presentados
  mediante el sistema TRIBU-CR…»), the renta-specific carrier. The cost is a
  probe plus a replay. It still competes for the same two pins, so it may
  change nothing for this case.
- **C. Treat the channel as out of the question's scope** and drop it from the
  case's requirements. The owner decides; it is carried, so #592's rule keeps
  it.

## Item 4: RES-0020 and RES-0033 as expected targets (report only)

The hit-rate gate counts a case as a hit when **any** expected target is in
the top-k (`caseHit`). A new target can turn a miss into a hit and never a hit
into a miss. All the candidates below already hit in Wave G. The one miss,
`ho-t2-credito-iva-compras`, is unrelated. So the gate stays at **73/74
(0.986 against 0.94)** and the robustness hit stays at 27/27. What moves is
#570's reported «all expected targets reached» (Wave G: 50/74, robustness
14/27), and the census grows by the new targets. All of them are in
`eval/corpus-index.json`, so they are satisfiable.

| Case                            | Reasonable new target(s)                                     | Where they sit (probe)                                     | All-targets effect               |
| ------------------------------- | ------------------------------------------------------------ | ---------------------------------------------------------- | -------------------------------- |
| `ho-rebajar-25-sin-facturas`    | RES-0020 Art. 3, beside or instead of RES-0011 Art. 2        | not in pool                                                | none: already cut                |
| `ho-iva-en-cero-sin-facturar`   | RES-0033 Art. 1 and Art. 3                                   | Art. 1 set#6; Art. 3 order#13, cut                         | none: already cut                |
| `tribu-cr-declarar-pagar`       | RES-0020 Art. 3, RES-0033 Art. 3 (and Art. 4 / Art. 6, pago) | RES-0020 Art. 3 order#12, cut; RES-0033 Art. 3 not in pool | none: already cut                |
| `iva-declaracion-mensual`       | RES-0033 Art. 1 («cómo»); Art. 4 is weaker                   | Art. 1 set#6; Art. 4 order#9, cut                          | none with Art. 1; −1 with Art. 4 |
| `renta-declaracion-plazo`       | RES-0020 Art. 2 (the plazo)                                  | pool#15 · order#17, cut                                    | **−1** (50 → 49)                 |
| `renta-plazo-followup`          | RES-0020 Art. 2                                              | not probed (follow-up)                                     | likely −1, as its parent         |
| `rb-corto-cuando-declaro-renta` | RES-0020 Art. 2                                              | pool#40 · order#22, cut                                    | **−1** robustness (14 → 13)      |
| `rb-corto-cuando-declaro-iva`   | RES-0033 Art. 1, Art. 4                                      | set#6, set#7                                               | none                             |

Not candidates: `ho-donde-inscribo-ya-no-atv` (inscription, not filing) and
the desinscripción cases (the resolutions don't describe it).

So the narrow version (rows 16 and 18 only: `ho-rebajar-25-sin-facturas`,
`ho-iva-en-cero-sin-facturar`) moves no number. The wide version
(`renta-declaracion-plazo`, its follow-up and its robustness seed) costs about
2 on all-targets and 1 on robustness all-targets, on one probe's draw. A lane
would re-read it. Either way the 0.94 gate doesn't move.

The quoted sentences are excerpts of official public documents of the
Government of Costa Rica (Hacienda), outside the repository's Apache-2.0
license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
