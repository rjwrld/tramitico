-- Atomic wholesale chunk replacement (ADR 0002, issue #59).
--
-- Ingestion idempotency hangs on replacing a document's chunks wholesale; done
-- as separate delete + insert statements from the client, a crash mid-insert
-- strands the document with zero or partial chunks. This function performs the
-- delete and the insert of the new set in one call — one transaction — so the
-- replacement either lands whole or not at all.
--
-- p_chunks: jsonb array of {articulo, path, part, content, embedding};
-- `embedding` is a json number array cast to extensions.vector.
--
-- SECURITY INVOKER: the caller's own privileges apply. Only service_role may
-- execute it (see grants at the bottom), matching search_chunks: RLS on chunks
-- — which has no write policy — is bypassed by that role alone, never by anon.

set search_path = '';

create or replace function public.replace_chunks(
  p_document_id uuid,
  p_chunks jsonb
)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  inserted integer;
begin
  delete from public.chunks where document_id = p_document_id;

  insert into public.chunks (document_id, articulo, path, part, content, embedding)
  select
    p_document_id,
    c ->> 'articulo',
    coalesce(
      array(select pg_catalog.jsonb_array_elements_text(c -> 'path')),
      '{}'
    ),
    (c ->> 'part')::integer,
    c ->> 'content',
    (c ->> 'embedding')::extensions.vector
  from pg_catalog.jsonb_array_elements(p_chunks) as c;

  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

comment on function public.replace_chunks(uuid, jsonb) is
  'Atomic wholesale chunk replacement (ADR 0002, issue #59): deletes a document''s chunks and inserts the new set in one transaction. Service-role only; consumed by scripts/ingest.ts via replaceDocumentChunks().';

revoke all on function public.replace_chunks(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function public.replace_chunks(uuid, jsonb)
  to service_role;
