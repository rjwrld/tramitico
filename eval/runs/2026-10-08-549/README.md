# Does the deterministic routed decline run in production? (#549)

Read on 2026-10-08 around 22:30 UTC, main at ddfb9a1. No provider calls and no
production asks. Every read was a log query or a `SELECT` over content-free
columns: no question, answer, condensed-question or subject value was read.

**Answer: production cannot tell us.** #264 shipped on 2026-09-04, before
production went live on 2026-09-15, so all production traffic ran with
routing. But nothing readable records which asks took the routed decline.

## 1. Vercel runtime logs: one hour of retention

```sh
vercel logs --project tramitico --environment production --since 30d \
  --query "tramitico.event" --json --limit 1000      # 0 lines
vercel logs --project tramitico --environment production --since 30d \
  --json --limit 1000                                # 2 lines
vercel logs --project tramitico --environment production --since 30d \
  --query "/api/ask" --json --limit 1000             # 0 lines
```

The 30-day query returned two request lines, at 21:50:10 and 22:23:34 UTC, with
the read at 22:32. Both were inside the last hour, and neither was an
`/api/ask` request. That is Hobby's one-hour window. Every `routedCategory`
line from before 21:32 UTC that day is gone. Runbook Q15, the count of
declines by category, can only be read live.

## 2. Production `questions`: signed-in asks only, no category

`public.questions` holds `id, user_id, question, answer, citations,
created_at, condensed_question`. It has no column for the decline kind or the
routing category. `streamHonestDecline` saves a decline with `citations: []`,
and the citation invariant keeps an answer from shipping without one. So an
empty `citations` array marks an honest decline, routed or fail-closed:

```sql
select date_trunc('day', created_at)::date as day, count(*) as rows,
  count(*) filter (where jsonb_typeof(citations) = 'array'
                     and jsonb_array_length(citations) = 0) as zero_citation_rows
from public.questions group by 1 order by 1;
```

| Day        | Rows | Zero-citation rows |
| ---------- | ---- | ------------------ |
| 2026-09-17 | 2    | 0                  |
| 2026-09-18 | 1    | 0                  |
| 2026-09-19 | 1    | 0                  |
| 2026-09-22 | 10   | 0                  |
| 2026-09-24 | 10   | 0                  |
| 2026-09-29 | 1    | 0                  |
| 2026-10-04 | 1    | 0                  |

None of the 26 signed-in asks got an honest decline. Anonymous asks never
persist, so this covers only signed-in traffic.

## 3. Production `rate_limits`: counts, pruned, no outcome

Grouped by window and by subject prefix, without reading any subject. It shows
one anonymous subject with 11 asks on 2026-10-06 and 9 on 2026-10-07, and
nothing older, since `rate_limit_increment` deletes rows past retention. It
records that asks were charged, not what they returned.

## 4. The eval record

All 26 committed `abstention-*.jsonl` transcripts under `eval/runs/` hold 202
rows. Every row has `route: "model"` and none has `"fallback"`
(`abstention.eval.test.ts` sets `route` from `viaFallback`). That includes the
six #503 routed cases in the #511, #512 and #546/#547/#550 lanes.

## Decision

Option 3 (triage on #549): SPEC §9 and eval/README.md's «Routed cases»
section now say that e2e alone covers the deterministic decline
(`e2e/routing.local.spec.ts`, with the free classifier test
`src/lib/eval/routing-dataset.test.ts`), and that the eval's routed cases
measure the model's routing. Option 2 adds a paid case to every lane, and was
not done.
