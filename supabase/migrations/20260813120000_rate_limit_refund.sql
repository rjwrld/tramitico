-- Atomic refund for rate_limits (issue #126, decision on #121): a system
-- failure — provider outage, retrieval error, internal error — gives the ask
-- back. Completed answers, honest declines included, keep consuming it.
--
-- Single UPDATE, so the row lock that makes rate_limit_increment race-free
-- covers this too: a refund and a concurrent ask for the same subject
-- serialize on the same row instead of reading a stale count.
--
-- Two guards on the target row:
--   * `window_start = p_window_start` — a refund only ever touches the row the
--     ask consumed. Once the CR day has rolled over the predicate matches
--     nothing and the refund is a no-op, rather than stealing an ask back from
--     the new day's quota.
--   * `greatest(count - 1, 0)` — the counter can never go negative, so a
--     double refund cannot mint free asks.
-- Zero matched rows returns zero rows; callers treat that as "nothing to
-- refund", not an error.
create or replace function "public"."rate_limit_refund"(
  "p_subject" "text",
  "p_window_start" timestamp with time zone
) returns table ("count" integer)
language "sql"
set search_path = ''
as $$
  update "public"."rate_limits" as "rl"
  set "count" = greatest("rl"."count" - 1, 0)
  where "rl"."subject" = "p_subject"
    and "rl"."window_start" = "p_window_start"
  returning "rl"."count";
$$;

revoke all on function "public"."rate_limit_refund"("text", timestamp with time zone) from "public";
grant execute on function "public"."rate_limit_refund"("text", timestamp with time zone) to "service_role";
