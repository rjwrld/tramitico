-- #602: read-only lookups on the shared local stack (894 chunks).
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f eval/runs/2026-10-10-602/queries.sql

-- Q1. Every chunk of the three TRIBU-CR resolutions, plus the FAQ entries that
-- put TRIBU-CR beside the desinscripción, with whether the chunk names ATV.
SELECT d.doc_key, c.articulo, c.id,
       (c.content ~* 'ATV|Administraci[oó]n Tributaria Virtual') AS names_atv
FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
WHERE d.doc_key IN ('tribu-cr-res-0011-2025', 'tribu-cr-res-0020-2025', 'tribu-cr-res-0033-2025')
   OR (d.doc_key = 'tribu-cr-faq'
       AND c.content ~* 'desinscrib[a-z]* del sistema TRIBU-CR|TRIBU-CR[^.]{0,80}desinscrip')
ORDER BY 1, 2;

-- Q2. The new carriers' quotes in eval/runs/2026-10-08-554/carriers.json, the
-- way scripts/tier1-miss-causes.ts checks them. Every row must read true.
SELECT q.id, position(q.quote IN regexp_replace(c.content, '\s+', ' ', 'g')) > 0 AS carries
FROM (VALUES
  ('08b0596b-132d-4a05-8e4a-598ed2295db0'::uuid, 'Los obligados tributarios deben liquidar los impuestos a los que estén afectos utilizando el sistema en línea TRIBUCR'),
  ('46dd069c-a43d-4df2-9a2b-ee29021d2fec'::uuid, 'Los formularios en esta resolución estarán disponibles para ser llenados y presentados mediante el sistema TRIBU-CR'),
  ('f8cf1bac-f7fa-4188-8d16-fcc13e65bf13'::uuid, 'Los formularios de declaración indicados en el artículo 1 estarán disponible para ser llenados y presentados mediante el sistema TRIBU-CR')
) AS q(id, quote)
JOIN public.chunks c ON c.id = q.id;

-- Q3. What each ATV-naming preámbulo says about ATV: only the ones that say it
-- «no continuará» carry the claim.
SELECT c.id, substr(c.content, greatest(1, strpos(c.content, 'Administración Tributaria Virtual') - 220), 480) AS ctx
FROM public.chunks c
WHERE c.id IN ('9b4bbb77-8a66-436f-8558-d6f79d7af767', 'f9f122e6-d46a-4f66-8ec5-bf83807db4fc',
               '6c8b8695-a95a-4792-802c-fe5138bfeed8', '3ea7f95f-911a-4705-8347-a626c4c7a186',
               '619098ba-7685-4483-987b-5788e748281a');
