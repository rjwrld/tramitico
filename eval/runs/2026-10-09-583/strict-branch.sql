-- #583: every step-catalogue sentence on search_chunks' lexical rules, read-only
-- on the shared local stack. One row per sentence and rank (top 3): whether
-- the strict websearch_to_tsquery branch matches anything, how many chunks
-- it matches, and the chunk at each rank of the branch the RPC would use
-- (strict, or the OR fallback with its coverage weight).
-- The `values` list is eval/step-catalogue.json at this commit, in family
-- and sentence order (T1-D#5 and T1-I#5 are #562's).
-- Usage: psql "$LOCAL_DB_URL" -f eval/runs/2026-10-09-583/strict-branch.sql
-- To read one target's place, swap the final select's `rk <= 3` for a
-- doc_key/articulo filter.
with s(label, sentence) as (values
  ('T1-A#2', 'Todo trabajador independiente, costarricense o extranjero que resida en el país, debe cumplir sus obligaciones de afiliación y contribución con el Seguro de Salud y el Seguro de Invalidez, Vejez y Muerte de la CCSS.'),
  ('T1-D#3', 'Está exenta del impuesto la prestación de servicios por contribuyentes del impuesto cuando sean consumidos fuera del territorio nacional, y se documenta con factura electrónica de exportación.'),
  ('T1-E#1', 'Los contribuyentes del impuesto sobre las utilidades deberán presentar una declaración jurada de autoliquidación del impuesto y pagar la respectiva deuda tributaria dentro de los dos meses y quince días naturales siguientes al cierre del período fiscal.'),
  ('T1-F#2', 'El trabajador independiente gestionará el ajuste del ingreso sobre el cual se calcularán sus contribuciones a los seguros sociales en los primeros 3 días hábiles del mes, de forma presencial en las oficinas o mediante las plataformas tecnológicas que la institución habilite.'),
  ('T1-H#1', 'Para solicitar la desinscripción del sistema TRIBU-CR se ingresa a la Oficina Virtual, en «Mis datos» se selecciona «Solicitar desinscripción» y, con «Cierre de negocio» como motivo, se completa la fecha de fin de actividades económicas.'),
  ('T1-H#3', 'En caso de que el trabajador independiente suspenda la actividad generadora de ingresos, debe comunicarlo de forma inmediata a la sucursal donde se afilió para la suspensión de la facturación, demostrando que cesó la actividad económica propia.'),
  ('T1-I#1', 'Las sanciones se reducirán cuando el infractor subsane de forma espontánea su incumplimiento sin que medie ninguna actuación de la Administración, y la reducción es mayor si autoliquida y paga la sanción en el momento de subsanar el incumplimiento.'),
  ('T1-I#3', 'Quienes omitan presentar la declaración de inscripción deberán liquidar y pagar una sanción del cincuenta por ciento (50%) de un salario base por cada mes o fracción de mes, y quienes omitan presentar las declaraciones tributarias tendrán una multa del cincuenta por ciento (50%) del salario base.'),
  -- #583's proposed split of T1-H#1, one sentence per chunk:
  ('H1-31 (draft)', 'Para solicitar la desinscripción del sistema TRIBU-CR se ingresa a la Oficina Virtual, se selecciona la opción «Mis datos» y en esa sección está el botón o enlace «Solicitar desinscripción».'),
  ('H1-43 (draft)', 'Si se selecciona «Cierre de negocio» como motivo de desinscripción, únicamente se debe completar el campo de fecha de fin de actividades económicas.')
),
q as (
  select s.label, s.sentence,
    exists (select 1 from public.chunks c where c.tsv @@ websearch_to_tsquery('spanish', s.sentence)) as strict,
    (select string_agg(quote_literal(x.lexeme), ' | ') from unnest(to_tsvector('spanish', s.sentence)) x(lexeme))::tsquery as orq,
    (select array_agg(lexeme) from unnest(to_tsvector('spanish', s.sentence))) as lex
  from s
),
r as (
  select q.label, q.strict, d.doc_key, c.articulo,
    row_number() over (
      partition by q.label
      order by ts_rank_cd(c.tsv, case when q.strict then websearch_to_tsquery('spanish', q.sentence) else q.orq end) desc, c.id
    ) as rk,
    case when q.strict then 1.0
      else (select count(*) from unnest(q.lex) l(x) where c.tsv @@ quote_literal(l.x)::tsquery)::float / array_length(q.lex, 1)
    end as coverage
  from q
  join public.chunks c on c.tsv @@ case when q.strict then websearch_to_tsquery('spanish', q.sentence) else q.orq end
  join public.documents d on d.id = c.document_id
)
select label, strict, rk, doc_key || ' · ' || coalesce(articulo, '-') as chunk, round(coverage::numeric, 2) as coverage
from r
where rk <= 3
order by label, rk;
