# The retrieval wave, 2026-10-12 (#611)

#611 makes Tier 1 carrier recall higher and the same from run to run. It
doesn't touch the answer prompt. This directory holds the wave's record.
Step 0 is free. Each paid step runs only after an owner OK, one at a time.
The owner stopped the wave after step 3: see «Wave stopped after step 3»
at the end.

| File                                       | What it is                                                                                               |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [`preregistration.md`](preregistration.md) | The bars (R1–R4, G, A, L), the stop rules and the budget, committed before any draw.                     |
| [`carriers.json`](carriers.json)           | The frozen carrier list: 64 rows over 24 cases. `pnpm carrier-recall` reads it.                          |
| `xref-replay.ts` · `xref-replay.log`       | Free: what #508's cross-reference pin ranked on `ho-t2-credito-iva-compras`'s set in both lanes (below). |

## Step 0 (free, no provider call)

- **`scripts/carrier-recall.ts`** (`pnpm carrier-recall <carriers.json>
<probe.json>…`) reads N `answer-set-probe` JSONs. Per draw it prints
  hit-rate (gated and robustness block), all targets reached, `isWeak` and
  the median set size. Per row of the list it prints the share of draws that
  carry it, plus the mean over (row, draw) pairs. Per case it prints the
  median pairwise Jaccard, and whether the step-pinned subset was the same on
  every draw. It also lists every case whose `isWeak` flips across draws, and
  every case a draw excluded for a lost rerank reading. Unit-tested in
  `scripts/carrier-recall.test.ts`, which also checks that every carrier in
  the frozen list is in `eval/corpus-index.json`.
- **`eval/tier1-carriers.json`** gains the three carriers the lanes didn't
  print: `tribu-cr-faq` Declaraciones del RUT · 3
  (`ho-donde-inscribo-ya-no-atv`), `reglamento-renta` Artículo 12
  (`ho-minimo-renta-2026`) and `ccss-reglamento-ti` Artículo 7
  (`ho-tambien-asegurado-por-patrono`). That makes 52 chunks over 22 cases.
- **The list and the bars** are in `preregistration.md` and `carriers.json`.
  There is one deviation from §3: the list adds seven rows from #609's read,
  because §3's two files don't carry four of the 16 retrieval misses. The
  owner kept them on 2026-10-12, before any draw.

A smoke run on three committed probes (2026-10-09 #561/#562, 2026-10-08
`rerank-off`; old corpus, different configs) parsed every case and printed
every section. It was a check of the tool and measures nothing.

## `ho-t2-credito-iva-compras`: the groundedness fail and the hit-rate miss

«El IVA que pago en mis compras, ¿me lo puedo rebajar?» Tier 2, held out.
Targets: `ley-iva` Artículo 21 (operaciones que dan derecho a crédito fiscal)
and Artículo 17 (requisitos subjetivos del crédito fiscal). Read from both
lanes' committed transcripts and logs, and from the code.

### The groundedness fail is a judge reading of a pass-through reference

The confirming answer says: «Si el crédito es mayor que el débito en un
período, la diferencia es un saldo a favor que puede aplicarse en los términos
del artículo 37 del Reglamento [4].» Fragment [4] is `reglamento-iva`
Artículo 25, and it ends: «la diferencia constituye un saldo a favor del
contribuyente que podrá aplicarse en los términos del artículo 37 de este
Reglamento.» The answer restates the fragment's own pointer and adds nothing
about art. 37.

The three judges failed it on the reason «that fragment does not mention
article 37; it only states that excess credit may be applied 'en los
términos del artículo 37 de este Reglamento'». That reason quotes the very
sentence it says is missing. The label judge read the same sentence as «accurately
restates … without inventing what article 37 contains». Wave G's set also
held Art. 25; its answer didn't mention art. 37, and it passed.

### Should #508's pin have fetched `reglamento-iva` 37? No, not by its rules

`xref-replay.ts` runs `crossReferencedChunks` on each lane's cut (the reranked
eight plus the two step picks) with a stub lookup, and prints the ranking the
pin hands to the database (`xref-replay.log`):

- **Confirming lane:** 12 candidates. First is `ley-iva` 11, which the cut
  names as deferring a figure («la tarifa reducida del artículo 11 de la
  Ley», in `reglamento-iva` 25, 30 and 32). `reglamento-iva` 37 is 10th.
  `CROSS_REFERENCE_CAP` is 1, so `ley-iva` 11 took the slot; it is the
  set's 11th chunk. A cap of 2 would have fetched `reglamento-iva` 15, and 37
  would need a cap of 10.
- **Wave G:** `ley-iva` 11 first again, and appended. `ley-iva` 28 in that
  cut names `ley-iva` 21, one of the targets, but 21 doesn't make the
  12-candidate limit.

The pin did what ADR 0024 and #508's measurement chose: figure-deferring
references first, one append. Fetching 37 would take a different ranking rule
for this one sentence, and #508's probe found a second slot brought no
expected target on any case.

### The hit-rate miss is the pool, not the cut

Neither target is in the fused 40 on either lane (`pool#—`), even though both
expansions are about «crédito fiscal del impuesto al valor agregado soportado
en la adquisición de bienes y servicios». The untiered sibling
`iva-credito-fiscal-compras` («¿Puedo usar como crédito fiscal el IVA que
pago…?») has the same two targets. It pools them at the tail (21 at
pool#26–28, 17 at pool#33–38), and the rerank lifts them to rr#2–7 in both
lanes. So the question's own words bring them into the pool, the expansion
alone doesn't, and the rerank keeps them once they're there. «Rebajar» doesn't
reach «crédito fiscal» on the question's legs. That makes this a class-N miss
(in no pool read). The bottleneck is the pool, unlike §1's read of the Tier 1
misses.

### What fix 1 or fix 2 would need

- **Fix 1 can't reach it.** It reorders and widens the step picks. The
  case classifies T1-D on «iva». T1-D's six `reaches` are `ley-iva` 27, 10
  and 3, `reglamento-iva` 40 and 11 and `cnpt` 79 (the monthly return, the
  exempt export, the rate, the fine). None of them carries crédito fiscal
  or names art. 21, 17 or 37. A wider `STEP_PINS` only adds more of them to
  this set, so the case is worth watching under R4 and G during the sweep.
- **Fix 2 would need a T1-D sentence that reaches `ley-iva` 21.** No T1-D
  Tier 1 case requires a crédito fiscal step: its three cases are the monthly
  return and its deadline, the exempt export, and the omitted-return fine. §2
  writes a sentence only where a family step the dataset already requires has
  none, so this one is out of scope. It would also be written toward a
  held-out Tier 2 case (#254 §B8, ADR 0023). Not proposed.
- **What would move it, outside fixes 1 and 2:** fix 3 (several expansions,
  their pools merged) is the only ranked fix aimed at class N, and it runs
  only if R2 still fails. Step 1's probe records this case's pool and order
  five times, which is free to read before anything else.

**Recommendation:** no fix for this case in fixes 1/2. The groundedness fail
reads as judge noise on a faithful sentence. If it recurs, the fix belongs to
the judge or the answer prompt, not to retrieval.

## Step 1: control, 5 live probe draws on main (ran 2026-10-13)

The results are in [`control/README.md`](control/README.md).

Run from this worktree, written below as `<worktree>`. Its pipeline code equals `origin/main`: `git diff
origin/main -- src corpus supabase scripts/answer-set-probe.ts` is empty, and
the branch changes only scripts, tests and eval files no pipeline step reads.
Rewrites are **live**: `EVAL_REWRITES` is unset, and the probe's log must
read `rewrites: live`. `ANSWER_EFFORT` doesn't reach the probe, since it has
no answer model, but it is set to production's value anyway. The runs are
serial, about 6 minutes each at `PROBE_CASE_MS=3000` (116 cases).

```sh
W=<worktree>
OUT=$W/eval/runs/2026-10-12-611/control
mkdir -p "$OUT"

# 3-case smoke first (≈US$0.01): a follow-up, the Tier 2 miss, an abstention case.
env -u EVAL_REWRITES -u STEP_PINS EVAL_CASES=ho-ademas-tengo-salario,ho-t2-credito-iva-compras,ho-abs-iva-2027 \
  PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
  pnpm -C "$W" answer-set-probe "$OUT/smoke.json" 2>&1 | tee "$OUT/smoke.log"

# The five draws, one after another.
for i in 1 2 3 4 5; do
  env -u EVAL_REWRITES -u EVAL_CASES -u STEP_PINS PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
    pnpm -C "$W" answer-set-probe "$OUT/probe-$i.json" 2>&1 | tee "$OUT/probe-$i.log"
done

# Free: the control's numbers.
pnpm -C "$W" carrier-recall "$W/eval/runs/2026-10-12-611/carriers.json" \
  "$OUT"/probe-{1,2,3,4,5}.json | tee "$OUT/carrier-recall.log"
```

**Cost:** ≈US$1.50 for the five draws (Voyage embeddings and rerank readings,
Haiku 5.5 expansions and condensations), plus ≈US$0.01 for the smoke. Steps
1–5 stop at US$12.

## Step 2: the width sweep, knob only (ran 2026-10-13)

The results are in [`step2.md`](step2.md). Neither arm passes R1–R4.

`STEP_PINS=3` and `STEP_PINS=5`, five live draws each, on the same code as
the control. `STEP_PINS=5` pins every fresh pick, since a family has at most
five. No code changes: `STEP_PINS` is a knob (`rerank.ts`). Each arm runs a
3-case smoke first. It must read `rewrites: live`, and its largest `step` pin
count must be above 2 (the control's is 2), which proves the knob took. If it
isn't, the arm stops before any draw. The ten draws run serially, about 6 minutes each.

```sh
W=<worktree>
for w in 3 5; do
  OUT=$W/eval/runs/2026-10-12-611/pins$w
  mkdir -p "$OUT"
  env -u EVAL_REWRITES STEP_PINS=$w EVAL_CASES=ho-ademas-tengo-salario,ho-t2-credito-iva-compras,ho-abs-iva-2027 \
    PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
    pnpm -C "$W" answer-set-probe "$OUT/smoke.json" 2>&1 | tee "$OUT/smoke.log"
  jq '[.reads[] | [.per["top8/capoff/pinon"].pins // {} | to_entries[] | select(.value=="step")] | length] | max' "$OUT/smoke.json"
  for i in 1 2 3 4 5; do
    env -u EVAL_REWRITES -u EVAL_CASES STEP_PINS=$w PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
      pnpm -C "$W" answer-set-probe "$OUT/probe-$i.json" > "$OUT/probe-$i.log" 2>&1
  done
  pnpm -s -C "$W" carrier-recall "$W/eval/runs/2026-10-12-611/carriers.json" \
    "$OUT"/probe-{1,2,3,4,5}.json > "$OUT/carrier-recall.log"
done
```

**Cost:** ≈US$3.00 for the ten draws, plus ≈US$0.02 for the two smokes. That
brings steps 1–2 to ≈US$4.50 of the US$12 cap for steps 1–5.

## Step 3: fix 1 at `STEP_PINS=3`, step picks ranked by the question's own score (ran 2026-10-13)

The results are in [`fix1-pins3/README.md`](fix1-pins3/README.md). The arm
fails R1–R4.

Fix 1 ranks `pin1`'s fresh picks by the question's own Voyage score for each
pick, instead of their place in the question-and-expansion order
(`cutWithSteps` in `rerank.ts`). It is tested at width 3 (Amendment 2). The
code goes in a new worktree off main once #616 has merged, written below as
`<fix1-worktree>`. These files reach it through main.

```sh
W=<fix1-worktree>
WIDTH=3
OUT=$W/eval/runs/2026-10-12-611/fix1-pins$WIDTH
mkdir -p "$OUT"

# Smoke: `rewrites: live`, and the largest `step` count must be 3.
env -u EVAL_REWRITES STEP_PINS=$WIDTH EVAL_CASES=ho-ademas-tengo-salario,ho-t2-credito-iva-compras,ho-abs-iva-2027 \
  PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
  pnpm -C "$W" answer-set-probe "$OUT/smoke.json" > "$OUT/smoke.log" 2>&1
jq '[.reads[] | [.per["top8/capoff/pinon"].pins // {} | to_entries[] | select(.value=="step")] | length] | max' "$OUT/smoke.json"

# Five live draws, one after another.
for i in 1 2 3 4 5; do
  env -u EVAL_REWRITES -u EVAL_CASES STEP_PINS=$WIDTH PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
    pnpm -C "$W" answer-set-probe "$OUT/probe-$i.json" > "$OUT/probe-$i.log" 2>&1
done

# Two frozen-rewrite draws on draw 1's rewrites: R2's picks must agree on all 27 (Amendment 2).
for i in 1 2; do
  env -u EVAL_CASES EVAL_REWRITES="$OUT/probe-1.json" STEP_PINS=$WIDTH PROBE_CASE_MS=3000 ANSWER_EFFORT=low \
    pnpm -C "$W" answer-set-probe "$OUT/frozen-$i.json" > "$OUT/frozen-$i.log" 2>&1
done

# Free reads.
pnpm -s -C "$W" carrier-recall "$W/eval/runs/2026-10-12-611/carriers.json" \
  "$OUT"/probe-{1,2,3,4,5}.json > "$OUT/carrier-recall.log"
pnpm -s -C "$W" carrier-recall "$W/eval/runs/2026-10-12-611/carriers.json" \
  "$OUT"/frozen-{1,2}.json > "$OUT/frozen-recall.log"
pnpm -s -C "$W" exec tsx eval/runs/2026-10-12-611/bars.ts "$OUT" > "$OUT/bars.log"
pnpm -s -C "$W" exec tsx eval/runs/2026-10-12-611/bars.ts --picks \
  "$OUT"/frozen-{1,2}.json > "$OUT/frozen-picks.log"
```

The frozen logs must read `rewrites: replayed from …`. **Cost:** ≈US$1.60:
≈US$1.50 for the five live draws, plus ≈US$0.10 for the two frozen ones,
which ask Voyage only. That brings steps 1–3 to ≈US$6.00 of US$12.

## Wave stopped after step 3 (owner, 2026-10-13)

The owner stopped the wave after step 3. No more paid calls. The evidence
ships, and fix 1's code does not (the #460/#470 pattern).

### What each step measured

Five live `answer-set-probe` draws per arm, read by `bars.ts` against the
control. R2 is Amendment 2's measure and R3 is Amendment 1's.

| Arm                                 | R1 carrier recall (needs ≥ 63.1 %, floor 3/5) | R2 picks identical (needs ≥ 90 %) | R3 hit-rate · robustness                | R4 median size (≤ 13) | R1–R4    |
| ----------------------------------- | --------------------------------------------- | --------------------------------- | --------------------------------------- | --------------------- | -------- |
| [control](control/) (main, width 2) | 53.1 %                                        | 7/27                              | 71–73/74 · 130/135                      | 11                    | baseline |
| [`pins3`](pins3/) (width 3)         | FAIL 60.9 %, floor held                       | FAIL 16/27                        | PASS 70–71/74 · 133/135                 | PASS 12               | FAIL     |
| [`pins5`](pins5/) (width 5)         | PASS 63.3 %, floor held                       | FAIL 22/27                        | FAIL 69/74 = 93.2 % on draw 2 · 133/135 | PASS 13               | FAIL     |
| [`fix1-pins3`](fix1-pins3/) (fix 1) | FAIL 60.9 %, floor broken on 2 rows           | FAIL 19/27                        | PASS 70–73/74 · 131/135                 | PASS 12               | FAIL     |

No arm passes R1–R4, so by the stop rules no answer spend (steps 6–7) was
due.

### Why it stopped

- **Recall is flat.** Fix 1 reads 195/320 (60.9 %), the same as width 3
  alone. It changes which rows are carried, not how many.
- **Fix 1 breaks the floor.** Two rows the control carries on 4+/5 draws
  fall to 2/5: `ccss-pedir-prescripcion-cuotas`'s resolution deadline (4/5 →
  2/5) and `ccss-obligacion-ingreso-bajo`'s legal basis (5/5 → 2/5).
- **R2's residual comes from the live rewrites.** With the rewrites frozen,
  fix 1's two draws pick the same catalogue chunks on 26/27 cases. With live
  rewrites they agree on 19/27. The expansion still moves the pool and the
  top 8, and ranking the pins alone doesn't hold the set still. The one
  frozen miss, `ho-rebajar-25-sin-facturas`, fits embeddings that aren't
  bit-identical (#457).
- Width 5 passes R1 but fails R2 and R3, and sits at R4's limit.

### Where the code lives

Fix 1's code (`cutWithSteps` ranking fresh picks by the question's own
Voyage score, with its unit tests) is on the kept branch
[`rjwrld/611-fix1-question-score-code`](https://github.com/rjwrld/tramitico/tree/rjwrld/611-fix1-question-score-code)
(commit 36f2bb4). It was reverted on #621 and never reached main.
Production stays on `pin1` at `STEP_PINS=2`.

### Not tried

- Fix 2, the catalogue (#602 items 1 and 2, and the gap sentences).
- Fix 3, several expansions merged. It is the only fix aimed at the
  rewrite variance that R2's residual points to.

### Spend

Steps 1–3 cost about **US$6.00** (estimated; no log prints a cost):
≈US$1.45 for the control, ≈US$2.95 for the width sweep and ≈US$1.60 for
fix 1. That is within the US$12 cap for steps 1–5.
