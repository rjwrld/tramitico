# Retrieval wave 2, 2026-10-28 (#628)

This wave follows #611, which stopped after step 3. It tries the two fixes
#611 never ran: fix 3 (several expansions per ask, their pools merged) and
fix 2 (step-catalogue gap sentences for #602 items 1 and 2). Step 0 is free,
and it made no provider call. Each paid step runs only after an owner OK.

| File                                       | What it is                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| [`preregistration.md`](preregistration.md) | Draft: arms, bars (R1–R4, as #611's), stop rules, budget. Before any paid draw |
| `merge-estimate.ts` · `merge-estimate.log` | Free: fix 3 simulated on #611's five control draws                             |

## Step 0: fix 3 estimated from #611's control (free)

#611's control (`../2026-10-12-611/control/probe-{1..5}.json`) ran five live
draws, and each one used a different expansion. Per case, every draw
recorded its fused pool of 40, its whole reranked order and Voyage's score at
each place. So merging k draws per case stands in for one ask that ran k
expansions.

```sh
pnpm exec tsx eval/runs/2026-10-28-628/merge-estimate.ts \
  eval/runs/2026-10-12-611/carriers.json \
  eval/runs/2026-10-12-611/control/probe-{1,2,3,4,5}.json \
  > eval/runs/2026-10-28-628/merge-estimate.log
```

Rows of the 64-row carrier list a merged pool carries, as the mean over
every k-subset of the five draws. «Ever» counts the rows carried by at least
one subset.

|   k | Subsets | Union of pools (ever) | 40-row merged pool (ever) | Top 8 by rerank score (ever) |
| --: | ------: | --------------------- | ------------------------- | ---------------------------- |
|   1 |       5 | 52.4 (58)             | 52.4 (58)                 | 15.8 (26)                    |
|   2 |      10 | 55.8 (58)             | 53.3 (57)                 | 15.6 (23)                    |
|   3 |      10 | 57.3 (58)             | 53.7 (57)                 | 15.2 (21)                    |
|   5 |       1 | 58.0 (58)             | 57.0 (57)                 | 15.0 (15)                    |

For comparison, the answer set the probe recorded (`top8/capoff/pinon`,
pins included) carries 34.0 rows a draw.

**Go/no-go: NO-GO.** A single draw's pool misses 11.6 rows. Merging 3 draws
brings 4.9 of them in on the union (42 %), and 1.3 on the 40-row proxy
(11 %). The bar was half, so fix 3's code isn't written.

- **Why so little.** Six rows are in no pool on any of the five draws, so no
  number of expansions reaches them:
  - row 18: `tribu-cr-res-0020-2025` Artículo 3, for `ho-rebajar-25-sin-facturas`;
  - rows 36–38: the OVi FAQ entries for `ho-donde-inscribo-ya-no-atv`;
  - row 46: `ley-renta` Artículo 24;
  - row 56: `cnpt` Artículo 57.

  The other 5.6 missed rows a draw are the ones that do vary, and three
  draws catch most of them. But they are a small share, since 46 of the 64
  rows are in the pool on every draw.

- **The cut doesn't gain either.** The top 8 carry slightly fewer rows as k
  grows (15.8 → 15.2), because a bigger pool sends more competitors to the
  same eight places. The carriers that do reach the set get there through
  the pins (34.0 against 15.8), as #611 §1 found.

### What the recorded data can and can't estimate

- **The pool.**
  - The union of the k pools is exact as a set, and it is the ceiling: fix
    3's pool still holds 40 rows.
  - The probe records no per-leg rank, so the real one-fusion pool can't be
    replayed. The 40-row column is a proxy: an RRF over the k draws' fused
    ranks.
  - The question's legs are the same in every draw, except on follow-ups,
    whose condensation is live too.
- **The cut.**
  - Voyage's score for a chunk in one draw is the max over the question's,
    that draw's expansion's and the step sentences' readings
    (`fuseByMaxScore`). It isn't the question's reading alone, as the brief
    assumed.
  - With fix 3 reading every expansion, a merged chunk's score is the max
    of its per-draw scores. That is exact for a chunk every draw pooled, and
    a lower bound for one that only some draws did.
  - The method checks out on single draws: the simulated top 8 equals the
    probe's recorded cut on 580/580 reads.
- **The answer set.** It isn't estimated. The step pins depend on the
  catalogue's picks and on the cut, and the cross-reference, salario-base
  and derived-figure pins depend on the cut. None is recorded in a form a
  merge can replay.
- **R2 (Jaccard).** It isn't estimated. It needs whole merged answer sets
  for two independent groups of draws, and five draws give one group of 3
  and one of 2 that share nothing.

## Fix 2: proposed, not committed to the catalogue

The two sentences, their targets and the free checks are in
[`preregistration.md`](preregistration.md) («Arms»). They aren't in
`eval/step-catalogue.json`: production retrieval reads that file, so a
sentence merged to main changes production. They would go on arm A's branch
only. As step 0 found, arm A can't meet R1 on its own targets (≤ 55.9 %
against 63.1 %), so the draft recommends stopping here.

## Step 1 (only on the owner's OK; the draft recommends not running it)

Arm A runs from a worktree off main that carries the two catalogue edits,
written below as `<fix2-worktree>`. The control is #611's.

```sh
W=<fix2-worktree>
OUT=$W/eval/runs/2026-10-28-628/fix2
mkdir -p "$OUT"

# Smoke (≈US$0.01): must read `rewrites: live`.
env -u EVAL_REWRITES -u STEP_PINS EVAL_CASES=ho-rebajar-25-sin-facturas,desinscripcion-dejar-actividad,ho-abs-iva-2027 \
  PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
  pnpm -C "$W" answer-set-probe "$OUT/smoke.json" > "$OUT/smoke.log" 2>&1

# Five live draws, one after another (≈US$1.50).
for i in 1 2 3 4 5; do
  env -u EVAL_REWRITES -u EVAL_CASES -u STEP_PINS PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
    pnpm -C "$W" answer-set-probe "$OUT/probe-$i.json" > "$OUT/probe-$i.log" 2>&1
done

# Free reads against #611's control.
pnpm -s -C "$W" carrier-recall "$W/eval/runs/2026-10-12-611/carriers.json" \
  "$OUT"/probe-{1,2,3,4,5}.json > "$OUT/carrier-recall.log"
pnpm -s -C "$W" exec tsx eval/runs/2026-10-12-611/bars.ts "$OUT" > "$OUT/bars.log"
```

**Cost:** ≈US$1.51 in all, against step 1's US$8 hard stop. Before it runs:
balance confirmed by owner.
