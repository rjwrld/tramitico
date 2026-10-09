# Why Tier 1 carriers are still unreached after Wave E, 2026-10-09 (#583)

#583 listed what Wave E (#561's `STEP_PINS=2`, #562's two catalogue sentences)
left out of the answer sets: #561's rows 4 (`cnpt` 79), 18, 23–25 and 27,
#562's rows 8, 16, 17, 20 and 26, two robustness misses (TRIBU-CR's
desinscription path, TRIBU-CR as the renta channel), and 8 of 38 catalogue
sentences that miss `search_chunks`'s strict AND branch. This record says, per
leftover, where the carrier is lost and what would fix it. Row numbers are
#554's table (`../2026-10-08-554/`).

**Free.** No provider call, no write. The inputs are Wave E's lane transcript
(`../2026-10-09-497-wave-e/lane/`), #562's probe (`../2026-10-09-562/probe-after.json`,
main's code plus the two shipped sentences and the two dropped ones),
#561's step-pick read (`../2026-10-09-561/step-picks.json`) and read-only
`SELECT`s on the shared local stack (873 chunks, the corpus the lane ran on).
`step-picks.ts` is not keyless (it embeds, expands and calls Voyage), so only
its saved JSON was read.

| File                                     | What it is                                                                                                                                              |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`read.mjs`](read.mjs)                   | Every #554 carrier in Wave E's lane set; per classified Tier 1 case in #562's probe, what pin1 appended and each leftover carrier's fused/question rank |
| [`strict-branch.sql`](strict-branch.sql) | The 8 sentences on `search_chunks`'s lexical rules, plus the two drafts below                                                                           |

## Result

**Four causes, and one of them isn't retrieval.**

| Cause                                                                   | Leftovers                                                               |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| A. Reached in Wave E's lane: stated, or dropped by the answer (cause 3) | rows 4, 8, 17 stated; rows 23–25 dropped with `ley-renta` 22 in the set |
| B. Pooled and picked, loses both pin slots to the question's ranking    | row 18 (`tribu-cr-res-0011-2025` 2), row 27 (`cnpt` 79)                 |
| C. A sentence joins two chunks and the reading picks the other one      | the robustness desinscription miss (`tribu-cr-faq` RUT · 31)            |
| D. No sentence, and the corpus has only a generic or partial carrier    | rows 16 and 18's channel half, 20, 26; the «D-140 ya no existe» clause  |

Nothing is «never pooled» among the rows in scope: every carrier with a
sentence is in the fused 40 of #562's probe, and each sentence picks the chunk
it was written for, except T1-H#1 (cause C).

## The table

Wave E lane = in that lane's answer set / requirement stated. Probe ranks are
#562's arm: `f` fused, `q` the question's reranked order, of 40; the cut is
q1–q8 and pin1 appends the two fresh picks with the best `q`.

| Row                 | Case                                           | Carrier                                                   | Wave E lane            | Probe (f/q)                | Cause | Proposed fix                                    |
| ------------------- | ---------------------------------------------- | --------------------------------------------------------- | ---------------------- | -------------------------- | ----- | ----------------------------------------------- |
| 4                   | `desinscripcion-dejar-actividad`               | `cnpt` 79 (+ `ley-iva` 27)                                | 79 out, 27 in / stated | 79 f12/q40                 | A     | none: the `ley-iva` 27 half carries it          |
| 8                   | `ho-desde-cuanta-plata-caja`                   | `ccss-reglamento-ti` 7, `ccss-faq` «¿Dónde puedo pagar…?» | out / **stated**       | —                          | A     | none: stated in Wave D's and E's lanes          |
| 17                  | `ho-hasta-que-dia-tengo-iva`                   | `cnpt` 88, `tribu-cr-res-0011-2025` 2                     | out / **stated**       | —                          | A     | none: missed in D, stated in E (one-lane noise) |
| 23–25               | `ho-ademas-tengo-salario`                      | `ley-renta` 22                                            | **in** (#10) / missed  | f11/q29, not appended      | A (3) | prompt side: scoped `answer-replay` (paid)      |
| 18                  | `ho-rebajar-25-sin-facturas`                   | `tribu-cr-res-0011-2025` 2                                | out / missed           | f21/q40                    | B, D  | corpus: a renta-specific channel source         |
| 27                  | `ho-desinscribir-debiendo-declaraciones`       | `cnpt` 79                                                 | out / missed («50 %»)  | f15/q35                    | B     | none cheap (below)                              |
| robustness          | `rb-pill-me-salgo`, `rb-tilde-deje-de-trabajr` | `tribu-cr-faq` RUT · 31                                   | out / missed           | f22/q17, f8/q12; 43 picked | C     | split T1-H#1 (drafts below)                     |
| robustness, literal | `desinscripcion-dejar-actividad`               | RUT · 31 and 43                                           | both in / missed       | 31 in the cut              | A, D  | requirement review: «D-140» has no carrier      |
| 16                  | `ho-iva-en-cero-sin-facturar`                  | `tribu-cr-res-0011-2025` 2 («dónde»)                      | out / missed           | not pooled                 | D     | corpus, same source as row 18                   |
| 20                  | `ho-minimo-renta-2026`                         | `reglamento-renta` 12                                     | out / missed           | f24/q24, no sentence       | D     | none under two pins (below)                     |
| 26                  | `ho-tambien-asegurado-por-patrono`             | `ccss-reglamento-ti` 7 (partial)                          | out / missed           | f18/q22, no sentence       | D     | requirement review, or a CCSS source            |

### A. Reached, or no longer missed

- **Rows 4, 8, 17** are stated in Wave E's lane. Row 8 was stated in Wave D's
  lane too, with neither carrier in either set, so #554's «uncertain» flag on
  it resolves to «not a miss» on current code.
- **Rows 23–25.** `ley-renta` ARTICULO 22 sat at #10 of
  `ho-ademas-tengo-salario`'s set in Wave E's lane (and in Wave D's), and the
  answer still left out the pagos parciales, their dates and the «dos meses y
  quince días». On these two lanes they are cause 3, not retrieval. The
  retrieval side is a coin flip: in #562's probe `reglamento-renta` 28 (q25)
  and `ley-renta` 8 #2 were appended ahead of `ley-renta` 22 (q29), a few
  places apart, so which two go in changes draw to draw (#561's read had 22
  in, the probe has it out).

### B. Loses both pin slots

pin1 orders the fresh picks by the question's reading (#460). The two chunks
here are generic, a channel and a sanction, so they rank at or near the bottom
of the question's 40 in every read:

- `tribu-cr-res-0011-2025` Artículo 2 is T1-E#3's pick at **q40** in every T1-E
  case of #562's probe and #561's read (q37–q39 in the probe's T1-I cases,
  where it is appended twice). It reached no T1-E answer set in either. T1-E has four sentences, and
  this one is last every time.
- `cnpt` 79 is T1-H#2's pick at q35–q40 in every T1-H case. On row 27's case
  it is the fourth of four fresh picks; #561's counterfactual reached it only
  with `pin` (every pick).

Reordering doesn't reach them: by fused rank (#561's read) they are still
last or next to last among the fresh picks (`res-0011` 2 at f17–f19, `cnpt` 79
at f11–f12). `STEP_PINS=3` reaches row 18 on #561's read and not row 27, at one
more fragment on every classified ask, the `pin` cost (#311).

**Proposed fix, row 18:** not a retrieval knob. The corpus carries the channel
only as Artículo 2's generic sentence («la única plataforma digital
tributaria…»); no chunk says that the renta or IVA declaration is presented in
TRIBU-CR. The `tribu-cr-faq` source covers RUT, OVi access, notifications and
the CIH, not the D-101 or D-104. A Hacienda guide that names the declaration
and the channel together would rank on the question's own legs. Check for one
against `corpus/manifest.json` and ingest it (one corpus PR, with the
`eval/corpus-index.json` re-dump). Row 16's «dónde» half has the same carrier
and the same fix, and the T1-D sentence that would reach Artículo 2 is
already recorded as measured and dropped.

**Row 27:** nothing cheap. It is the price of a two-pin cap on a family whose
four picks are all fresh on that case. Options for the owner: accept it, or
measure `STEP_PINS=3` in a full lane (groundedness is the risk).

### C. T1-H#1 picks RUT · 43, not RUT · 31

T1-H#1 joins two FAQ answers in one sentence: RUT · 31 (where: Oficina Virtual
→ «Mis datos» → «Solicitar desinscripción») and RUT · 43 (the «Cierre de
negocio» motivo and the fecha de fin). It matches nothing on the strict branch,
and on the OR fallback RUT · 31 is lexical #7 and 43 #12. Its reranked pick in
every T1-H read is **43**. RUT · 31 then reaches the set only when the
question's own reading puts it in the cut (q1 on
`ho-desinscribir-debiendo-declaraciones`, q8 on `desinscripcion-dejar-actividad`).
On the two robustness variants it is pooled (f22/q17, f8/q12) and left out,
while 43 is appended: the answers name «Mis datos» and «Declaración de
desinscripción» from `tribu-cr-faq` CIH · 24, not the request path.

**Proposed fix:** split T1-H#1 into one sentence per chunk, in each chunk's
words. Both drafts match their chunk alone on the strict branch, at rank 1
([`strict-branch.sql`](strict-branch.sql)):

- RUT · 31: «Para solicitar la desinscripción del sistema TRIBU-CR se ingresa a
  la Oficina Virtual, se selecciona la opción «Mis datos» y en esa sección está
  el botón o enlace «Solicitar desinscripción».»
- RUT · 43: «Si se selecciona «Cierre de negocio» como motivo de
  desinscripción, únicamente se debe completar el campo de fecha de fin de
  actividades económicas.»

The trade, read off #562's probe on the assumption each draft picks its own
chunk: on `rb-pill-me-salgo` the fresh picks would be 31 (q17), 43 (q24),
`ley-iva` 27 (q35), `cnpt` 79 (q40), so 31 and 43 go in and `ley-iva` 27 (an
expected target there) goes out; `rb-tilde-deje-de-trabajr` the same (q10,
q12, q22). The other T1-H cases already hold 31 in the cut. T1-H goes to five
sentences, the cap. The narrower alternative replaces T1-H#1 with the RUT · 31
draft alone, which keeps four sentences and swaps 43 for 31. Either needs one
`answer-set-probe` (≈US$0.15) before it ships, as #562's sentences did; this
record doesn't ship it.

**Requirement review (owner):** the desinscription requirement ends «el
antiguo formulario D-140 ya no existe». No chunk mentions D-140. On
`desinscripcion-dejar-actividad` both RUT · 31 and 43 were in Wave E's set and
the requirement still failed. Rewriting it to what the corpus carries is a
dataset change, so it's the owner's call.

### D. Thin or partial carriers, no sentence

- **Row 20.** `reglamento-renta` Artículo 12 is the only chunk that dates the
  period. #562's sentence for it reached the set of two other cases, displacing
  a `ley-renta` 8 fragment, and never the set of `ho-minimo-renta-2026`; it was
  dropped. Under two pins, T1-E's four picks already compete for two slots.
  No fix proposed. The tramos chunk says «período fiscal 2026» without the
  dates.
- **Row 26.** No chunk describes registering both conditions; `ccss-reglamento-ti`
  7 is the afiliación duty in general (#554's «uncertain»). T1-F is at five
  sentences. Either a requirement review or a CCSS source on the dual
  condition.
- **The IVA-on-inventory claim** on the two desinscription robustness variants
  (`reglamento-iva` 67) is reached by no T1-H sentence. It was in the probe's
  cut on `rb-pill-me-salgo` (q7) and not pooled on `rb-tilde-deje-de-trabajr`.
  Not in #583's list; noted for the same T1-H probe.

## The 8 sentences off the strict branch

All 8 hold on the local corpus (`strict-branch.sql`). Each one's target, its
place on the OR fallback (which ranks by `ts_rank_cd` and weights the RRF
contribution by coverage), and what its reading picked where a read shows it:

| Sentence | Why it misses                     | Target on the fallback                                | Its pick                                                                                     | Costs a carrier?                 |
| -------- | --------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------- |
| T1-A#2   | paraphrase                        | `ccss-reglamento-ti` 1: #3, cov 0.94                  | the target (#561's read, both T1-A cases)                                                    | no                               |
| T1-D#3   | joins exención and export invoice | `reglamento-iva` 11: #2, cov 0.92                     | the target (appended on `ho-hasta-que-dia-tengo-iva`)                                        | no                               |
| T1-E#1   | paraphrase                        | `reglamento-renta` 28: #4, cov 0.95                   | the target (#561's read, both T1-E cases)                                                    | no                               |
| T1-F#2   | paraphrase                        | `ccss-reglamento-ti` 12: #2, cov 0.95                 | the target (appended on all three T1-F cases)                                                | no                               |
| T1-H#1   | joins RUT · 31 and RUT · 43       | 31: #7, cov 0.58; 43: #12, cov 0.74                   | **43** in every T1-H read                                                                    | **yes: RUT · 31** (C)            |
| T1-H#3   | paraphrase                        | `ccss-faq` «¿Qué debo hacer si dejo…?»: #32, cov 0.79 | the target in #561's read; `ccss-reglamento-ti` 8 (desafiliación) appended on one probe case | no: Art. 8 carries the same step |
| T1-I#1   | paraphrase                        | `cnpt` 88: #1, cov 0.82                               | not observable (88 is usually in the T1-I cut)                                               | no                               |
| T1-I#3   | joins `cnpt` 78 and 79            | 78: #31, 79: #76 (outside the 50)                     | not observable (78 and 79 are in the cut at q1–q6)                                           | not on these reads               |

The strict branch decides pooling, and every target here is pooled through its
vector leg and the question's own legs anyway. The rerank reading decides the
pick, and a paraphrase still picks its chunk. **Only the joined sentence costs
a carrier**, because a reading has one first place. T1-I#3 is the same shape
and harmless today only because the question carries both articles to the cut.
The `$comment`'s «wins the strict branch outright» holds for 32 of 40; a
unit-lane guard can't check it (it needs the corpus), so the proposal is to
reword only T1-H#1 now and the other paraphrases when their family is next
probed.

## Proposed next steps, by cost

1. **Free, owner's call:** review the desinscription requirement's «D-140»
   clause and row 26's requirement against what the corpus carries.
2. **≈US$0.15, needs the orchestrator's OK:** one `answer-set-probe` with
   T1-H#1 split (or replaced by the RUT · 31 draft), rewrites replayed from
   `../2026-10-09-562/probe-after.json`. Read RUT · 31 and `ley-iva` 27 on the
   T1-H cases.
3. **Corpus PR:** a Hacienda source naming the renta (and IVA) declaration's
   channel in TRIBU-CR, for rows 16 and 18. Free to look for; ingesting it
   embeds (cents) and needs the census re-dump.
4. **Paid, scoped:** rows 23–25 are the prompt's: `answer-replay
--cases=ho-ademas-tengo-salario` on a set that holds `ley-renta` 22.
5. **Not proposed:** `STEP_PINS=3` or reordering the pins. Reordering by fused
   rank reaches neither B row, and a third pin only reaches row 18, at the
   `pin` cost.

## Reproduce

```
node eval/runs/2026-10-09-583/read.mjs
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f eval/runs/2026-10-09-583/strict-branch.sql
```

The quoted sentences are excerpts of official public documents of the
Government of Costa Rica (Hacienda, CCSS, SINALEVI), outside the repository's
Apache-2.0 license; see the rights table in
[`docs/corpus-samples/README.md`](../../../docs/corpus-samples/README.md).
