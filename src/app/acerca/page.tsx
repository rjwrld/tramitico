import type { Metadata } from "next";
import Link from "next/link";

import { Colophon } from "@/components/colophon";

import { ACERCA_SOURCES_ANCHOR } from "@/components/chat/privacy-note";
import { Sello, effectiveLabel, fetchedLabel } from "@/components/sello";
import { loadCorpusSources, type CorpusSource } from "@/lib/corpus-sources";
import { corpusCount } from "@/lib/corpus-summary";
import { REPOSITORY_URL } from "@/lib/site";
import { NON_PROMISE_ITEMS, PROMISE_SENTENCE } from "@/lib/promise";

/**
 * The page that bridges the app to the code (#328): what Tramitico is, how
 * it answers, and which documents it answers from. Decisions recorded on the
 * issue; the short version:
 *
 * - Trust-seeker first: the promise opens the page, the sources close it.
 * - About the tool, not a person: no author block. The one outward link is
 *   to the open-source repository, under «Cómo funciona», since the code is
 *   the long answer to how it works.
 * - The source list is read from `public.documents`, never the manifest, so
 *   «consultado el» is the date the corpus actually pulled the document. No
 *   rows (a corpus-less stack, a missing service client) is an honest empty
 *   state, never «0 documentos».
 * - No motion. The chips are the sello motif with the stamp settle off:
 *   twenty stamps landing at once would be a staggered entrance (DESIGN §8).
 *
 * Same shell as `/privacidad` and `/terminos`: headings and paragraphs, one
 * hairline rule under the title, no cards (DESIGN §10).
 */

export const metadata: Metadata = {
  title: "Acerca",
  alternates: { canonical: "/acerca" },
  description:
    "Qué es Tramitico, cómo responde y de qué documentos oficiales responde.",
};

/**
 * The corpus changes per ingest, not per request: prerendered, refreshed at
 * most hourly. Must be a literal — Next reads it statically.
 */
export const revalidate = 3600;

/** The three sections, in order. Tests read this list. */
export const ACERCA_SECTIONS = [
  "Qué es",
  "Cómo funciona",
  "Las fuentes",
] as const;

export const EMPTY_SOURCES =
  "Todavía no hay documentos cargados en esta instalación.";

export default async function AcercaPage() {
  const sources = await loadCorpusSources();
  const [whatItIs, howItWorks, theSources] = ACERCA_SECTIONS;

  return (
    <main className="mx-auto w-full max-w-[44rem] px-6 py-12">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Volver al inicio
        </Link>
      </p>

      <h1 className="mt-8 font-serif text-[2rem] font-semibold tracking-display text-balance">
        Acerca de Tramitico
      </h1>
      <p className="mt-3 border-b border-border pb-8 text-sm text-muted-foreground">
        {PROMISE_SENTENCE}
      </p>

      <Section title={whatItIs}>
        <p>
          Una herramienta informativa para quien trabaja por cuenta propia en
          Costa Rica y tiene una pregunta sobre impuestos o trámites. Responde a
          partir de documentos oficiales del Ministerio de Hacienda y de la Caja
          Costarricense de Seguro Social, y cada afirmación señala el artículo
          del que sale, para que usted pueda leerlo en la fuente.
        </p>
        <p className="mt-4">Lo que no hace:</p>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {NON_PROMISE_ITEMS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </Section>

      <Section title={howItWorks}>
        <ol className="list-decimal space-y-3 pl-5">
          <li>
            Busca su pregunta en los documentos oficiales que tiene cargados,
            por significado y por palabras, y se queda con los fragmentos más
            pertinentes.
          </li>
          <li>
            Claude, de Anthropic, redacta la respuesta a partir de esos
            fragmentos y nada más, citando el artículo y el documento de cada
            afirmación. Una respuesta sin cita no se publica.
          </li>
          <li>
            Si no encuentra base oficial suficiente, lo dice y no adivina.
            Cuando la pregunta corresponde a otra institución, indica cuál.
          </li>
        </ol>
        <p className="mt-4">
          Tramitico es de código abierto: cualquiera puede revisar cómo busca,
          cómo redacta y cómo se pone a prueba.
        </p>
        <p className="mt-2">
          <a
            href={REPOSITORY_URL}
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            Código y documentación
          </a>
        </p>
      </Section>

      <Section title={theSources} id={ACERCA_SOURCES_ANCHOR}>
        {sources.length === 0 ? (
          <p data-slot="sources-empty">{EMPTY_SOURCES}</p>
        ) : (
          <>
            <p data-slot="sources-count" className="tabular-nums">
              {corpusCount(sources.length)}. Cada uno abre en el sitio de la
              institución que lo publica; las fechas son las del texto que
              Tramitico tiene cargado.
            </p>
            <ul
              aria-label="Documentos oficiales"
              className="mt-4 list-none space-y-4 p-0"
            >
              {sources.map((source) => (
                <SourceRow key={source.docKey} source={source} />
              ))}
            </ul>
          </>
        )}
      </Section>

      {/* The colophon: the standing pages, the same line the landing
          composer carries, at the foot of the document. */}
      <Colophon className="mt-12 border-t border-border pt-6" />
    </main>
  );
}

/**
 * One document: the sello (linking to the official address) over its dates,
 * in the same mono caption `SelloRow` prints under an answer, then the full
 * title and norma. The stamp's anatomy is fixed (DESIGN §5), so the title
 * sits beside it, never inside.
 */
function SourceRow({ source }: { source: CorpusSource }) {
  const vigente = effectiveLabel(source.effectiveAt);
  const consultado = fetchedLabel(source.fetchedAt);
  const dates = [vigente, consultado].filter((d): d is string => d !== null);
  return (
    <li
      data-slot="source"
      className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-4"
    >
      {/* A fixed column on wide screens so the titles align down the page;
          the longest date caption (both dates) fits on one line in it. */}
      <div className="flex flex-col items-start gap-1 sm:w-80 sm:shrink-0">
        <Sello citation={source} settle={false} preview={false} />
        {dates.length > 0 && (
          // One date per line: «vigente desde» over «consultado el», so a
          // document with both never wraps its year onto a line of its own.
          <span className="flex flex-col px-[1px] font-mono text-[0.6875rem] text-muted-foreground">
            {dates.map((d) => (
              <span key={d}>{d}</span>
            ))}
          </span>
        )}
      </div>
      <div className="min-w-0">
        <span className="text-foreground">{source.docTitle}</span>
        {source.norma && (
          <span className="block text-xs text-muted-foreground">
            {source.norma}
          </span>
        )}
      </div>
    </li>
  );
}

function Section({
  title,
  id,
  children,
}: {
  title: string;
  id?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-10 scroll-mt-8">
      <h2 className="font-serif text-xl font-semibold tracking-display">
        {title}
      </h2>
      <div className="mt-3 text-sm/6 text-muted-foreground">{children}</div>
    </section>
  );
}
