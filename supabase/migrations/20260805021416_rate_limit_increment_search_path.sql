-- Pin the search_path (security advisor 0011: function_search_path_mutable).
-- Safe because the function body schema-qualifies every reference.
alter function public.rate_limit_increment (text, timestamptz, timestamptz)
set search_path = '';
