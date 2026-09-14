import type { Metadata } from "next";
import Link from "next/link";

import {
  ACERCA_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
} from "@/components/chat/privacy-note";

/**
 * The privacy statement (#136 req. 3, privacy contract from #121).
 *
 * Plain prose, not a legal document: it names every third party a question
 * passes through, what is kept and for how long, and the two controls a
 * reader already has for getting rid of it. Written to be true of the code as
 * it stands — if a subprocessor is added, this page is part of that change,
 * and so it is when what an existing one *receives* changes: #132 added no
 * provider, but a follow-up now sends Anthropic the recent turns of the
 * conversation and stores the rewrite it produced, and both are said here.
 * Likewise a field added to the per-ask log line (#264's routing category)
 * is a claim this page makes about what the operational record holds.
 *
 * DESIGN §10 applies: no card grid, no eyebrows, no accent stripes. Headings
 * and paragraphs, one hairline rule under the title.
 */

export const metadata: Metadata = {
  title: "Privacidad — Tramitico",
  description:
    "Qué pasa con sus preguntas: a quién se envían, qué se guarda, por cuánto tiempo y cómo eliminarlo.",
};

/** The one place a privacy request can be sent. */
const CONTACT_EMAIL = "privacidad@tramitico.com";

/**
 * The one third party that never sees a question but does hold personal
 * data: the provider that delivers the sign-in email (#327 req. 7). Kept out
 * of SUBPROCESSORS on purpose — that list is «a quién se envía su pregunta»,
 * and Resend is not on the question's path. Named here so the page stays a
 * claim about the code (#136): adding or replacing the SMTP provider in the
 * hosted project's Auth settings must update this constant.
 */
const AUTH_EMAIL_PROVIDER = "Resend";

/**
 * Every third party a question or its answer touches, and why. Rendered as a
 * definition list rather than cards — four short entries do not need a grid.
 */
const SUBPROCESSORS = [
  {
    name: "Vercel",
    role: "Alojamiento de la aplicación. Atiende cada solicitud y conserva los registros operativos descritos abajo.",
  },
  {
    name: "Supabase",
    role: "Base de datos y sesiones. Guarda su cuenta, su historial y los documentos oficiales sobre los que se busca.",
  },
  {
    name: "Anthropic",
    role: "Redacción de la respuesta. Recibe su pregunta junto con los fragmentos oficiales recuperados. Recibe además su pregunta sola, antes de buscar, para reescribirla con los términos de la normativa y así encontrar el documento aunque usted no use sus palabras. Y cuando usted repregunta sobre lo mismo, recibe los últimos intercambios de esa conversación, para convertir la repregunta en una pregunta completa.",
  },
  {
    name: "Voyage AI",
    role: "Búsqueda semántica. Recibe su pregunta para convertirla en un vector y para ordenar los fragmentos más pertinentes.",
  },
] as const;

export default function PrivacyPage() {
  return (
    <main className="mx-auto w-full max-w-[44rem] px-6 py-12">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Volver al inicio
        </Link>
      </p>

      <h1 className="mt-8 font-serif text-[2rem] font-semibold tracking-display text-balance">
        Privacidad
      </h1>
      <p className="mt-3 border-b border-border pb-8 text-sm text-muted-foreground">
        Qué pasa con su pregunta desde que la escribe hasta que la elimina.
      </p>

      <Section title="A quién se envía su pregunta">
        <p>
          Para responder hace falta buscar en los documentos oficiales y
          redactar una respuesta citada. Eso pasa por cuatro proveedores, cada
          uno con una función distinta:
        </p>
        <dl className="mt-4 flex flex-col gap-3">
          {SUBPROCESSORS.map((sub) => (
            <div key={sub.name}>
              <dt className="font-medium text-foreground">{sub.name}</dt>
              <dd>{sub.role}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4">
          Sus preguntas no se venden, no se comparten con terceros fuera de esta
          lista y no se usan para entrenar modelos.
        </p>
      </Section>

      <Section title="Qué se guarda">
        <p>
          <strong className="font-medium text-foreground">
            Su cuenta, si inicia sesión.
          </strong>{" "}
          Su dirección de correo, o la que Google o GitHub entregan al autorizar
          el acceso. Cuando entra con un enlace por correo, ese mensaje lo envía{" "}
          {AUTH_EMAIL_PROVIDER}, que por eso conoce su dirección; no recibe
          ninguna pregunta ni ninguna respuesta.
        </p>
        <p className="mt-4">
          <strong className="font-medium text-foreground">
            Su historial, solo si inicia sesión.
          </strong>{" "}
          Cada intercambio guarda la pregunta, la respuesta, las fuentes citadas
          y la fecha, asociados a su cuenta. Si la pregunta era una repregunta,
          se guarda también la versión completa que el sistema armó con ella
          para poder buscar; su historial le muestra siempre lo que usted
          escribió. Se conserva hasta que usted lo elimine. Sin sesión iniciada
          no se guarda ninguna pregunta.
        </p>
        <p className="mt-4">
          <strong className="font-medium text-foreground">
            Registros operativos, sin contenido.
          </strong>{" "}
          Para detectar fallas se registra, por cada consulta, cómo terminó: si
          se respondió, cuánto tardó de forma aproximada y, cuando algo falla,
          el tipo de error y su código. Cuando no se encontró base oficial para
          responder, se registra también a qué institución se le remitió (una
          categoría de una lista fija: Hacienda, CCSS, INS, municipalidad,
          Registro Nacional, colegio profesional, banco, MEIC, migración o
          MTSS). Nunca el texto de la pregunta ni el de la respuesta, ni quién
          consultó. Los conserva el proveedor de alojamiento alrededor de 30
          días.
        </p>
        <p className="mt-4">
          <strong className="font-medium text-foreground">
            El conteo del límite diario.
          </strong>{" "}
          Si consulta sin iniciar sesión, el límite se lleva contra un
          identificador derivado de su dirección IP y su navegador mediante una
          función hash con clave secreta. No se guarda la dirección IP, y del
          identificador no se puede volver a ella ni llegar a las preguntas: no
          quedan asociadas a él.
        </p>
      </Section>

      <Section title="Cómo eliminarlo">
        <p>
          Puede borrar una pregunta a la vez desde su historial: se elimina la
          fila completa, con su respuesta y sus fuentes, de inmediato y sin
          copia.
        </p>
        <p className="mt-4">
          Eliminar la cuenta, desde el menú de su correo, borra la cuenta y todo
          su historial en la misma operación. Es irreversible.
        </p>
        <p className="mt-4">
          Los registros operativos no llevan contenido suyo, así que no hay nada
          que eliminar en ellos; expiran solos.
        </p>
      </Section>

      <Section title="Contacto">
        <p>
          Para cualquier consulta o solicitud sobre sus datos, escriba a{" "}
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="underline underline-offset-4"
          >
            {CONTACT_EMAIL}
          </a>
          .
        </p>
      </Section>

      <p className="mt-12 text-xs text-muted-foreground">
        Esta página describe el funcionamiento actual de Tramitico. Su dirección
        es{" "}
        <Link href={PRIVACY_PATH} className="underline underline-offset-4">
          tramitico.com{PRIVACY_PATH}
        </Link>
        . Las condiciones de uso del servicio están en{" "}
        <Link href={TERMS_PATH} className="underline underline-offset-4">
          Términos de uso
        </Link>
        ; qué es Tramitico y de qué documentos responde, en{" "}
        <Link href={ACERCA_PATH} className="underline underline-offset-4">
          Acerca
        </Link>
        .
      </p>
    </main>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-serif text-xl font-semibold tracking-display">
        {title}
      </h2>
      <div className="mt-3 text-sm/6 text-muted-foreground">{children}</div>
    </section>
  );
}
