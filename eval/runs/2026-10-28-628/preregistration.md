# #628 pre-registration: arms, bars, stop rules and budget (draft)

Drafted on 2026-10-28, as of main 87e497f, before any paid draw of the wave.
It is a **draft**. The owner settles the open points below, and once step 1
has run, nothing in this file changes. A result that misses a bar is reported
as a miss, and the bars are not moved to fit it. As in #611, no arm is chosen
on Tier 1 adequacy or on the count of fully adequate cases (ADR 0023).

## What step 0 settled (free)

- **Fix 3 is a no-go** ([`README.md`](README.md), `merge-estimate.log`).
  Merging 3 draws' pools brings in 4.9 of the 11.6 rows a single draw's pool
  misses. That is 42 % even on the union of the three pools, which is the
  ceiling, and the bar was half. Its code isn't written, so **arm B doesn't
  run**. The bars below keep B's clauses so the record says what B would
  have had to meet.
- **Arm A can't meet R1 on its own targets.** Fix 2 aims at two of the 64
  rows: row 18 (`ho-rebajar-25-sin-facturas`, 0/5 in the control) and row 28
  (`desinscripcion-dejar-actividad`'s ATV half, 1/5). If both are carried on
  every draw, recall rises from 170/320 to at most 179/320 = **55.9 %**. R1
  needs 202/320 = 63.1 %. Passing would take 23 more carried pairs from rows
  fix 2 doesn't aim at. Each new pick also competes for the two `STEP_PINS`
  slots, so a loss on those rows is as likely as a gain.

**Recommendation:** don't run step 1. By the stop rule, the wave ends at
step 0 with the evidence only, as #611 did (#621). If the owner wants fix 2
measured anyway, it is arm A below, and R1 is expected to fail.

## The carrier list

#611's frozen list, unchanged: [`../2026-10-12-611/carriers.json`](../2026-10-12-611/carriers.json)
(64 rows over 24 cases). The bars stay comparable to #611's this way.

## Control

**#611's control applies** ([`../2026-10-12-611/control/`](../2026-10-12-611/control/),
main 1da0897). `git diff 1da0897 origin/main -- src corpus supabase
scripts/answer-set-probe.ts eval/step-catalogue.json eval/dataset.jsonl
eval/corpus-index.json` is empty. Only `package.json` and `pnpm-lock.yaml`
changed on the pipeline's side: Dependabot patch bumps of `ai`,
`@ai-sdk/anthropic`, `@supabase/supabase-js`, `next` and `zod` (#620, #624,
#625). They are no retrieval-path file, and none changes a prompt, a leg or
the fusion. `eval/tier1-carriers.json` changed too, but it is diagnostic
only, and the frozen list above doesn't read it.

## Arms (step 1)

Each arm runs a 3-case smoke first, then five live `answer-set-probe` draws,
serially, at `PROBE_CASE_MS=3000`, with `EVAL_REWRITES` unset (the log must
read `rewrites: live`).

- **A: fix 2 only.** Two catalogue edits, on an arm branch off main and never
  on main unless the arm passes. `eval/step-catalogue.json` is read by
  production retrieval, so a sentence that lands on main changes production.
  - **T1-E, re-point** (#602 item 2): the TRIBU-CR channel sentence is
    replaced, so the count stays 4. It now reaches `tribu-cr-res-0020-2025`
    Artículo 3 in place of `tribu-cr-res-0011-2025` Artículo 2: «Los
    formularios de declaración del impuesto sobre las utilidades estarán
    disponibles para ser llenados y presentados mediante el sistema
    TRIBU-CR, accesible desde la página web del Ministerio de Hacienda.»
  - **T1-H, a fifth sentence** (#602 item 1, option B), reaching
    `tribu-cr-res-0011-2025` Artículo 1: «Se tienen por deshabilitadas las
    plataformas digitales tributarias Administración Tributaria Virtual
    (ATV), Trámites Virtuales (TRAVI) y DeclaraWeb.» Option C instead drops
    the ATV half from the requirement. That is a dataset decision, and #611
    left it to the owner. Under C, A is the T1-E edit alone.
  - **The #611 §2 rule.** Both cases are Tier 1, `variant: literal`, and
    neither is held out. Each step is one the dataset already requires
    (rows 18 and 28), and no sentence in its family reaches a chunk that
    carries it. The T1-E sentence's current target is the stale carrier of
    #602 item 3.
  - **Checked free** on the shared local stack, read-only: each target chunk
    exists, and each sentence's `websearch_to_tsquery` wins the strict AND
    branch with its target at lexical rank 1. T1-E's sentence also matches
    `tribu-cr-res-0020-2025` Preámbulo #0, at a 26× lower `ts_rank_cd`.
    T1-H's sentence matches nothing else.
- **B: fix 2 + fix 3 at `EXPANSION_COUNT=3`. Not run** (fix 3 no-go).

## The bars

The same as #611's, after its Amendments 1 and 2, so the results compare.
Candidate against control, 5 live draws each. A case that lost a rerank
reading is excluded from that draw and listed.

| Bar                   | Pass when                                                                                                                                                                               | Control (#611)                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| **R1** carrier recall | Mean share of (row, draw) pairs carried, over all 64 rows, **≥ 63.1 %** (control + 10 points). No row that control carries in ≥ 4/5 draws falls below 3/5 (28 floor rows).              | 170/320 = 53.1 %                     |
| **R2** stability      | Tier 1 median pairwise Jaccard **≥ control + 0.10 = 0.77**. Read as well, not gated: Amendment 2's picks measure (`bars.ts`).                                                           | 0.67; picks 7/27                     |
| **R3** no loss        | Hit-rate **≥ 94 %** on every draw. Robustness **≥ 25 on every draw and ≥ 130/135** summed. All-targets mean ≥ control − 1. `isWeak` unchanged on every case, abstention cases included. | 95.9–98.6 %; 130/135; 49.2; no flips |
| **R4** size           | Median answer-set size **≤ 13**.                                                                                                                                                        | 11                                   |

**B's latency and cost bound** (moot unless fix 3 is revived). N Haiku
expansions in parallel under the same 3 s `EXPAND_TIMEOUT_MS`. 2(N − 1) more
legs in one `search_chunks` call, plus N − 1 more embeds and rerank readings.
B would have to keep the probe's median `ms.retrieve` within control + 300
ms, and p95 within control + 1,000 ms. The added provider cost per ask must
stay ≤ US$0.002.

## Stop rules

- If no arm passes R1–R4, stop and ship the evidence only, as #621 did. No
  step 2 or later spend.
- If the smoke doesn't read `rewrites: live`, or a draw loses more than 2 %
  of its rerank readings, the arm stops before its next draw.
- The paid calls go through the owner one at a time.

## Later steps (placeholders, defined only if step 1 passes)

- **Step 2: answer-side work.** Defined only after step 1's result. The
  answer prompt stays out of scope (#594, #622).
- **Step 3: an adequacy judge by majority of 3**, to cut judge noise.
- **Step 4: two full lanes.** The numbers the project reports are the lower
  of the two lanes.

## Budget

Step 1 has a hard stop of **US$8**, and the wave as a whole **US$70**. Before
each paid step: balance confirmed by owner.

| Step               | Estimate                                                                                                                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1, arm A           | ≈US$1.50 for five draws plus ≈US$0.01 for the smoke, the same as #611's control (≈3,140 rerank readings at ≈US$0.0004, ≈655 Haiku 5.5 rewrites, embeddings ≈US$0). The T1-H sentence adds one reading on each T1-H case, for ≈US$0.01 over the arm. |
| 1, arm B (not run) | ≈US$2.30: arm A's, plus 2 more expansions and 2 more rerank readings per case per draw (≈1,160 each over five draws).                                                                                                                               |
| 2–4                | Not estimated until defined. #611 capped its one full live lane at US$12.                                                                                                                                                                           |
