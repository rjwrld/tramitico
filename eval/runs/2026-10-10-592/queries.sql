-- #592: read-only carrier checks on the shared local stack (894 chunks, after
-- #597 ingested tribu-cr-res-0020-2025 and tribu-cr-res-0033-2025).
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f eval/runs/2026-10-10-592/queries.sql

-- Q1. The filing channel for renta and IVA (rows 16, 18): TRIBU-CR beside a
-- renta/utilidades/IVA declaration, a D-code or «presentados mediante el sistema».
-- Before #597: 0 rows. After: the two Artículo 3 chunks.
SELECT d.doc_key, c.articulo
FROM public.chunks c JOIN public.documents d ON d.id = c.document_id,
  LATERAL (SELECT regexp_replace(c.content, '^\[[^\]]*\]\s*', '') AS body) b -- the title header names TRIBU-CR on every #597 chunk
WHERE (b.body ILIKE '%TRIBU-CR%' OR b.body ILIKE '%TRIBUCR%')
  AND (b.body ~* 'declaraci[oó]n(es)? (del|de|sobre)[^.]{0,40}(renta|utilidades|valor agregado|IVA)'
       OR b.body ~* '(D-?101|D-?104|formulario 1(01|50))'
       OR b.body ~* 'presentad[oa]s? mediante el sistema')
ORDER BY 1, 2;

-- Q2. The «D-140 ya no existe» clause (desinscripcion-dejar-actividad and its
-- two robustness variants): five phrasings.
SELECT 'D-140 any spelling' AS probe, count(*) AS n, string_agg(DISTINCT d.doc_key, ', ') AS docs
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id WHERE c.content ~* 'D[ -]?140'
UNION ALL SELECT 'formulario ... desinscrip', count(*), string_agg(DISTINCT d.doc_key || ' · ' || c.articulo, ' | ')
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE c.content ~* 'formulario[^.]{0,80}desinscrip|desinscrip[^.]{0,80}formulario'
UNION ALL SELECT 'declaración de desinscripción', count(*), string_agg(DISTINCT d.doc_key || ' · ' || c.articulo, ' | ')
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE c.content ILIKE '%declaración de desinscripción%'
UNION ALL SELECT 'ya no existe / formulario anterior', count(*), string_agg(DISTINCT d.doc_key || ' · ' || c.articulo, ' | ')
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE c.content ~* '(ya no existe|dej[oó] de existir|no continuar[aá]|sustitu[iy][a-z]* (el|los) formulario|formularios? anterior)'
UNION ALL SELECT 'ATV + deshabilit/desinscrip', count(*), string_agg(DISTINCT d.doc_key || ' · ' || c.articulo, ' | ')
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE c.content ~* 'ATV|Administraci[oó]n Tributaria Virtual' AND c.content ~* 'deshabilit|no continuar|desinscrip';

-- Q3. Row 20 (ho-minimo-renta-2026): the period's dates.
SELECT d.doc_key, c.articulo
FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
WHERE c.content ~* '(1|primero) de enero[^.]{0,60}31 de diciembre' AND c.content ~* 'per[ií]odo'
ORDER BY 1, 2;

-- Q4. Row 26 (ho-tambien-asegurado-por-patrono): registering in both conditions.
SELECT 'patrono reports/inscribes worker' AS probe, count(*) AS n, string_agg(DISTINCT d.doc_key || ' · ' || left(c.articulo, 60), ' | ') AS chunks
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE d.doc_key ~ '^(ccss|ley-10363)'
    AND c.content ~* '(patrono|empleador)[^.]{0,120}(inscrib|report|inclu|afili)[^.]{0,80}(trabajador|asalariad)'
UNION ALL SELECT 'both conditions + registration verb', count(*), string_agg(DISTINCT d.doc_key || ' · ' || left(c.articulo, 60), ' | ')
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE c.content ~* '(ambas condiciones|dos condiciones|asalariad[oa] y (a su vez )?(como )?trabajador independiente|asalariad[^.]{0,60}independiente)'
    AND c.content ~* '(afili|inscri|registr|gestion)'
UNION ALL SELECT 'TI afiliación procedure', count(*), string_agg(DISTINCT d.doc_key || ' · ' || left(c.articulo, 60), ' | ')
  FROM public.chunks c JOIN public.documents d ON d.id = c.document_id
  WHERE d.doc_key ~ '^(ccss|ley-10363)' AND c.content ~* '(gestionar|tr[aá]mite de|solicitar) (su |la )?afiliaci';
