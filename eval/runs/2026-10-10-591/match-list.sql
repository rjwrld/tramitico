-- #591's match list: every chunk that says «salario(s) base», and whether
-- #579's trigger (a multa or sanción in salarios base) and #591's (any amount
-- stated as a multiple or fraction of one) fire on it. Read-only: one SELECT,
-- run on the shared local stack (supabase-local MCP `execute_sql`).
--
-- The two patterns are `statesSanctionInSalariosBase` and
-- `statesAmountInSalariosBase` (src/lib/answer/salario-base.ts) in Postgres
-- ARE: `\y` for `\b`, `\m` for a word start. The body is folded the way
-- `fold()` does (accents off, lowercase, one space) and loses the ingestion
-- header «[title — artículo]», as there. census.ts runs the TypeScript
-- itself; the two must agree (census.log).
with body as (
  select
    c.id,
    d.doc_key,
    c.articulo,
    c.part,
    regexp_replace(
      lower(translate(
        regexp_replace(c.content, '^\[[^]]*\]\s*', ''),
        'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')),
      '\s+', ' ', 'g') as text
  from chunks c
  join documents d on d.id = c.document_id
)
select
  doc_key,
  articulo,
  part,
  id as chunk_id,
  text ~ '\y(multas?|sancion(es)?)\y([^.;:]|\.(?=[0-9])){0,160}?\ysalarios? base\y'
    as sanction_579,
  text ~ ('(\(?[0-9]([0-9.,]*[0-9])?\s?%?\)?|\(?\m(un|uno|una|medio|media|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieci[a-z]+|veinte|veinti[a-z]+|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|[a-z]*cientos|quinientos|mil)\)?) (del? (un )?)?salarios? base\y')
    as amount_591
from body
where text ~ 'salarios? base'
order by doc_key, articulo, part;
