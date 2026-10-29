# Retrieval wave 2, 2026-10-28 (#628)

This wave follows #611, which stopped after step 3. It tries the two fixes
#611 never ran: fix 3 (several expansions per ask, their pools merged) and
fix 2 (step-catalogue gap sentences for #602 items 1 and 2). Step 0 is free,
and it made no provider call. Each paid step runs only after an owner OK.

**Owner decision (2026-10-28), after step 0:** step 1 isn't run, so fixes 2
and 3 stop here. #602 item 1 is deferred: neither option B nor C, and the
dataset and the catalogue stay as they are. Step 0b, a larger cut, was then
estimated free and doesn't qualify for a paid step either (below).

| File                                       | What it is                                                                     |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| [`preregistration.md`](preregistration.md) | Draft: arms, bars (R1–R4, as #611's), stop rules, budget. Before any paid draw |
| `merge-estimate.ts` · `merge-estimate.log` | Free: fix 3 simulated on #611's five control draws                             |
| `cut-estimate.ts` · `cut-estimate.log`     | Free: a larger rerank cut (`ANSWER_TOP_K`) replayed on the same draws          |

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

**#602 item 1 is deferred** (owner, 2026-10-28). Neither option B (the
T1-H sentence) nor option C (dropping the ATV half from row 28's
requirement) is taken. `eval/dataset.jsonl` and `eval/step-catalogue.json`
stay as they are, and the T1-H sentence above is only a record.

## Step 1 (not run: owner, 2026-10-28)

Kept as a record of what arm A would have run.

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

## Step 0b: a larger rerank cut, replayed (free)

Step 0 showed the pool already holds ≈52 of the 64 carrier rows, the rerank
top 8 only ≈16, and the recorded answer set with its pins ≈34. So the cut is
the bottleneck, not the pool. `cut-estimate.ts` replays the same five
control draws at cuts of 8, 10, 12 and 16.

```sh
# Read-only dump of the shared local stack's chunks (894). Not committed: it
# is the corpus text, and the script only needs it to run the pins.
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -At -o /tmp/628-dump/chunks.json \
  -c "set default_transaction_read_only = on; select json_agg(json_build_object('chunkId', c.id, 'docKey', d.doc_key, 'docTitle', d.title, 'norma', d.norma, 'articulo', c.articulo, 'path', coalesce(c.path, '{}'), 'part', c.part, 'content', c.content, 'source', d.source, 'effectiveAt', d.effective_date, 'fetchedAt', d.fetched_at) order by c.id) from public.chunks c join public.documents d on d.id = c.document_id;"
sed -i '' '1{/^SET$/d;}' /tmp/628-dump/chunks.json

pnpm exec tsx eval/runs/2026-10-28-628/cut-estimate.ts /tmp/628-dump/chunks.json \
  eval/runs/2026-10-12-611/carriers.json \
  eval/runs/2026-10-12-611/control/probe-{1,2,3,4,5}.json \
  > eval/runs/2026-10-28-628/cut-estimate.log
```

All 697 chunk ids the five draws pooled are still in the dump.

### What it replays, and what it bounds

- **Replayed with production's code.** The cut is the first N of the
  recorded reranked order (`answerSetFromOrder`, `pin1`, `STEP_PINS=2`, no
  document cap). Then `pinAnswerSet` runs on the chunks rebuilt from the
  dump: the cross-reference, derived-input, salario-base and named-source
  pins. Their two lookups read the dump with production's filter
  (`part = 0`). A weak read keeps its empty set, since `isWeak` is decided
  on the pool and the cut doesn't change it.
- **Bounded: the step picks.** The probe records the picks that made the
  set at cut 8 (pinned `step`). It doesn't record the family's whole list,
  nor each pick's rank in the question's reading.
  - **Lower bound:** the recorded picks are the only ones. Each stays in
    the set at every N ≥ 8, through the cut or its pin. A slot the larger
    cut frees stays empty.
  - **Upper side:** a freed slot goes to the family's catalogue `reaches`
    in the pool, best reranked first. That only happens when both slots
    were full at cut 8. It is an estimate, not a strict bound.
- **Checks.**
  - At N = 8, both sides reproduce the recorded set, ids in order, on
    1160/1160 (read, side) pairs.
  - The probe also recorded a real cut of 10 (`top10/capoff/pinon`, real
    step picks). That set holds the lower side on 580/580 reads, and equals
    the upper side on 570/580. Its R1 is 176/320, the same as the upper
    side's. The upper side is close at N = 10.

### 1–3. Carrier rows, the answer set, and R1

The cut alone and the set are means over the five draws, out of 64 rows. R1
is over (row, draw) pairs and needs ≥ 202/320 = 63.1 %. The floor rows are
the 28 the control carries on ≥ 4/5 draws.

|   N | Cut alone | Set, lower – upper | R1, lower – upper         | Floor broken | Median set | Hit-rate per draw (of 74) | Robustness |
| --: | --------: | -----------------: | ------------------------- | ------------ | ---------: | ------------------------- | ---------: |
|   8 |      15.8 |               34.0 | 170/320 = 53.1 %          | none         |         11 | 71 / 71 / 73 / 72 / 72    |    130/135 |
|  10 |      19.6 |        34.8 – 35.2 | 174–176/320 = 54.4–55.0 % | none         |         13 | 72 / 72 / 73 / 73 / 73    |    134/135 |
|  12 |      21.6 |        35.0 – 36.2 | 175–181/320 = 54.7–56.6 % | none         |         15 | 72 / 72 / 73 / 73 / 73    |    134/135 |
|  16 |      25.6 |        36.6 – 39.0 | 183–195/320 = 57.2–60.9 % | none         |      18–19 | 72 / 73 / 73 / 73 / 73    |    135/135 |

`cut-estimate.log` has the per-row detail.

**No cut size clears 63.1 %.** The best is 60.9 % at N = 16 on the upper
side, and its median set is 19, past the 16 limit. **No candidate, so no
step 1b** is added to the preregistration.

- **Why the cut barely moves R1.** The cut alone gains 10 rows from 8 to 16.
  But most of them were already in the set through a pin. The step picks
  and the other pins reach deeper than the cut does, so growing the cut
  mostly absorbs chunks that were pinned anyway.
- **What the larger cut does reach** is the rows whose carrier sits at
  rerank ranks 9–16 and that no pin brings. From N = 8 to N = 16 the lower
  side's set gains draws on nine rows: 1, 13, 15, 31, 33, 39, 49, 51 and 54.
- **What no cut up to 16 reaches.** Sixteen rows are carried on no draw at
  N = 16, on either side.
  - Six are in no pool at all (step 0): rows 18, 36–38, 46 and 56.
  - The other ten sit in the pool, but never in the set: rows 8, 20, 26, 28,
    32, 43, 45, 47, 50 and 62. Rows 26 and 45 are pooled on 5/5 draws, the
    rest on 1–3 of 5.

### 4. The knob

It exists. **`ANSWER_TOP_K`**, default **8**, is read through
`positiveIntKnob` (`src/lib/answer/rerank.ts`, `answerTopK`) and listed in
`eval/README.md`'s Quick reference knob table. It cuts the reranked order
before the pins. `src/lib/retrieval.ts` has no cut of its own: the pool is
`RERANK_POOL = 40` (`rerank.ts`), and `DEFAULT_MATCH_COUNT = 8` there is
only the fused row count when a caller asks for none. `answer-set-probe`
already records `top10` beside `top8` in every draw.

### 5. What a larger set costs the answer call

- **Calibration.** Tokens are fitted to characters on #303's top-8/top-10
  pair (`../2026-09-15-top-k/`): 146 prompts with `pnpm prompt-tokens`'
  counts beside their transcripts. The line is tokens ≈ 4148 + 0.389 ×
  chunk characters, or 2.57 characters a token.
- **Applied as an upper bound.** It is applied to the characters as
  `buildUserPrompt` renders them, so headers included, and to the system
  prompt. It was fitted on chunk text alone, and on Sonnet 5's tokenizer,
  so it reads high. At N = 8 it gives a median prompt of ≈17.2k tokens. The
  2026-10-08 lanes measured ≈15.9k mean (1.64 M input tokens over 103
  prompts, Sonnet 5.5), so the estimate is about 8 % high.
- **Per chunk.** A chunk at N = 8 has a median of 2,262 rendered characters,
  ≈880 tokens. The chunks a larger cut adds are shorter: a median of
  1,930–2,011 characters, ≈750–780 tokens each.

|   N | Median set | Median answer prompt (tokens, user + system) | Growth over N = 8 | ≈ added input per answer at US$2/MTok |
| --: | ---------: | -------------------------------------------- | ----------------- | ------------------------------------- |
|   8 |         11 | 10.9k + 6.3k = 17.2k                         | —                 | —                                     |
|  10 |         13 | 12.9k + 6.3k = 19.2k                         | +2.0k, +12 %      | ≈US$0.004                             |
|  12 |         15 | 14.8k + 6.3k = 21.1k                         | +3.9k, +23 %      | ≈US$0.008                             |
|  16 |      18–19 | 19.1k + 6.3k = 25.4k                         | +8.2k, +48 %      | ≈US$0.016                             |

The price is Sonnet 5.5's input rate, from #611's price table. The added
tokens are chunks in the user prompt, so none is cached (only the system
prompt is, #414). In an eval lane the groundedness and adequacy judges read
the same chunks, so a lane's cost grows by about the same share.
