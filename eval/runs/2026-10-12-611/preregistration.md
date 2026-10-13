# #611 pre-registration: the carrier list and the bars

Committed on 2026-10-12, as of main 0cebb62, before any draw of the retrieval
wave. Nothing in this file changes once step 1 has run. A result that misses
a bar is reported as a miss, and the bars are not moved to fit it.

No arm is chosen on Tier 1 adequacy or on the count of fully adequate cases
(ADR 0023). The full lane runs once and isn't re-run to chase a number.

## The carrier list

[`carriers.json`](carriers.json): 64 rows over 24 cases. `pnpm carrier-recall`
reads it. A row is **carried** in a draw when every one of its parts has a
carrier in the route's answer set (`top8/capoff/pinon`). A carrier is
`docKey · articulo`, matched exactly as the lanes match a target
(`chunkMatchesTarget`), or a bare `docKey`, which matches any chunk of that
document.

| Rows | Source                                                                                                                                                                                                                                                                                                                                                                           |
| ---: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   27 | #554's hand-tagged requirements ([`../2026-10-08-554/carriers.json`](../2026-10-08-554/carriers.json), with #602's map), one row each, with #554's parts and carriers unchanged (`554#N`)                                                                                                                                                                                        |
|    7 | rows from #609's confirming-lane read ([`../2026-10-12-497-confirm/stability.mjs`](../2026-10-12-497-confirm/stability.mjs), `609#N`) that #554 lacks: the ATV half (#602 item 1), `ley-iva` 4/8 and 5, RUT · 2, Declaraciones del RUT · 3, `reglamento-comprobantes` 13 (the refiled one), `cnpt` 79 for `ho-iva-en-cero-sin-facturar`. Their requirement text is the dataset's |
|   30 | each [`eval/tier1-carriers.json`](../../tier1-carriers.json) chunk, after step 0's three additions, that no row of the same case names. These are lone carriers with no requirement text (`requirement: null`)                                                                                                                                                                   |

The other ten #609 rows restate a #554 row and are tagged on it. #554's
carriers stay as they are: #605 and #606 re-pointed rows 16–18 on purpose.

**One deviation from #611 §3.** §3 names the list as `tier1-carriers.json` +
#554's file. That list doesn't carry four of the confirming lane's 16
retrieval misses (the ATV carriers, `ley-iva` 4/8, `ley-iva` 5, RUT · 2).
Those are classes N, E and R, which fix 2 targets. The seven `609#` rows add
them, taken from #609's read of the confirming lane (`stability.mjs`).
**The owner kept them (2026-10-12), before any draw.** R1 reads on all 64
rows, and the list doesn't change from here on.

## The bars

Candidate against control, 5 live draws each, `PROBE_CASE_MS=3000`. A case
that lost a rerank reading is excluded from that draw and listed
(`carrier-recall` does both).

| Bar                   | Pass when                                                                                                                                                                                                                                                                                                  | `carrier-recall` line                                                    |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| **R1** carrier recall | The mean share of (row, draw) pairs carried, over all 64 rows, is **≥ control + 10 points**. No row that control carries in ≥ 4/5 draws falls below 3/5.                                                                                                                                                   | `R1 … mean over (row, draw) pairs`, and the per-row `k/n`                |
| **R2** stability      | The step-pinned subset is identical across draws on **≥ 90 %** of classified Tier 1 cases. Tier 1 median pairwise Jaccard **≥ control's** (fix 3, if it runs: ≥ control + 0.10).                                                                                                                           | `R2 median pairwise Jaccard: Tier 1 …`, `step-pinned subset identical …` |
| **R3** no loss        | Hit-rate **≥ 0.94** and ~~robustness hit **27/27** on every draw~~ (robustness: see Amendment 1). All-targets-reached mean ≥ control − 1. `isWeak` unchanged on every case, abstention cases included: no case flips within an arm, and each case's flag matches control's.                                | the per-draw table; `R3 isWeak differs across draws`                     |
| **R4** size           | Median answer-set size **≤ control + 2**.                                                                                                                                                                                                                                                                  | the per-draw `size` column                                               |
| **G** groundedness    | Scoped lane on the 34 Tier 1 rows (27 + 7 robustness), both arms on the **same `EVAL_REWRITES`**, so the pins are the only difference. Judges' first verdict: candidate ≥ control − 1. 0 false absence claims, 0 citation-invariant breaks, derived figures complete.                                      | the lane's own gates                                                     |
| **A** abstention      | Abstention lane on the candidate: **≥ 90 %**, and the invented-figure gate green (both earlier lanes: 15/15).                                                                                                                                                                                              | the lane's own gates                                                     |
| **L** confirming lane | One full lane, live: every hard gate green (groundedness ≥ 69, Tier 1 ≥ 88, robustness 27, hit-rate ≥ 0.94, abstention, citation, false-absence 0). Tier 1 requirements and fully adequate cases are **reported** against Wave G and the confirming lane. Any ratchet is the owner's call, by #512's rule. | the lane's own gates                                                     |

## Stop rules

- If no arm meets R1–R4 after the catalogue arm (step 4), stop before any
  answer spend and report.
- If G or A fails, stop before the lane.

## Budget

Hard stop for the wave: US$35. Steps 1–5 stop at US$12, step 6 at US$11,
step 7 at US$12. Owner OKs are needed before step 1, before step 6 and before
step 7, and the paid calls go through the owner one at a time.

## Amendment 1 (2026-10-13, before any candidate draw)

The owner's decision, made after the control (step 1) and before any step 2
draw. **R3's robustness clause** changes. Nothing else in this file changes.

- **Was:** «Hit-rate **≥ 0.94** and robustness hit **27/27** on every draw.»
- **Now:** hit-rate ≥ 0.94 on every draw, unchanged. Robustness hit **≥ 25
  on every draw** and **≥ 130/135 summed over the five draws**.
- **Why:** the control's five draws hit 26, 25, 26, 27 and 26 (130/135,
  [`control/README.md`](control/README.md)). On that noise, 27/27 on every
  draw would fail any arm, the control included. The new bar is «no worse
  than control».
