-- Atomic fixed-window increment for rate_limits (SPEC §7, issue #24).
-- Single statement: opportunistically deletes rows past retention, then
-- upserts the subject's counter — resetting it when the calendar window
-- has rolled over. INSERT ... ON CONFLICT provides the row-level lock that
-- makes the increment race-free under concurrent calls for the same subject.
create or replace function "public"."rate_limit_increment"(
  "p_subject" "text",
  "p_window_start" timestamp with time zone,
  "p_cutoff" timestamp with time zone
) returns table ("count" integer)
language "sql"
as $$
  with "cleanup" as (
    delete from "public"."rate_limits" where "window_start" < "p_cutoff"
  )
  insert into "public"."rate_limits" as "rl" ("subject", "window_start", "count")
  values ("p_subject", "p_window_start", 1)
  on conflict ("subject") do update set
    "count" = case when "rl"."window_start" = "excluded"."window_start"
                   then "rl"."count" + 1
                   else 1 end,
    "window_start" = "excluded"."window_start"
  returning "rl"."count";
$$;

revoke all on function "public"."rate_limit_increment"("text", timestamp with time zone, timestamp with time zone) from "public";
grant execute on function "public"."rate_limit_increment"("text", timestamp with time zone, timestamp with time zone) to "service_role";
