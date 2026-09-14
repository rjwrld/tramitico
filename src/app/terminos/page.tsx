import type { Metadata } from "next";
import Link from "next/link";

import { DISCLAIMER } from "@/components/chat/answer-block";
import {
  ACERCA_PATH,
  PRIVACY_PATH,
  TERMS_PATH,
} from "@/components/chat/privacy-note";
import { limitFor } from "@/lib/rate-limit";

/**
 * The terms of use (#326). Same pattern as `/privacidad`: plain prose in the
 * notaría register, true of the code as it stands, with a test that pins the
 * claims. Two of those claims are borrowed rather than restated so they cannot
 * drift — the disclaimer is the constant the answers render, and the quotas
 * are read from the rate limiter that enforces them.
 *
 * DESIGN §10 applies: headings and paragraphs, one hairline rule under the
 * title, no cards.
 */

export const metadata: Metadata = {
  title: "Términos de uso — Tramitico",
  description:
    "Qué es Tramitico, qué no es, y las condiciones bajo las que se ofrece.",
};

/** The same address `/privacidad` names; one inbox for both pages. */
const CONTACT_EMAIL = "privacidad@tramitico.com";

/**
 * The date these terms took effect, `YYYY-MM-DD`. Bump it whenever the text
 * changes in substance — the page shows it and the test checks its shape.
 */
export const TERMS_EFFECTIVE_DATE = "2026-09-14";

/** The eight sections, in the order the issue fixes. Tests read this list. */
export const TERMS_SECTIONS = [
  "Qué es Tramitico",
  "No es asesoría",
  "Sin garantía",
  "Uso aceptable",
  "Cuentas y datos",
  "Cambios",
  "Ley aplicable",
  "Contacto",
] as const;

const MONTHS_ES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/** `2026-09-14` → «14 de septiembre de 2026». */
function formatDateEs(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} de ${MONTHS_ES[m - 1]} de ${y}`;
}

export default function TermsPage() {
  // Read at build time: this page is prerendered. That matches enforcement
  // because on Vercel a function's env is fixed at deploy time as well, so a
  // quota override only takes effect through a redeploy, which rebuilds this
  // page with it. Forcing dynamic rendering would buy nothing here.
  const anonLimit = limitFor("anon");
  const authedLimit = limitFor("authed");
  const [
    whatItIs,
    notAdvice,
    noWarranty,
    acceptableUse,
    accounts,
    changes,
    law,
    contact,
  ] = TERMS_SECTIONS;

  return (
    <main className="mx-auto w-full max-w-[44rem] px-6 py-12">
      <p className="text-sm">
        <Link href="/" className="underline underline-offset-4">
          Volver al inicio
        </Link>
      </p>

      <h1 className="mt-8 font-serif text-[2rem] font-semibold tracking-display text-balance">
        Términos de uso
      </h1>
      <p className="mt-3 border-b border-border pb-8 text-sm text-muted-foreground">
        Las condiciones bajo las que se ofrece Tramitico. Vigentes desde el{" "}
        <time dateTime={TERMS_EFFECTIVE_DATE}>
          {formatDateEs(TERMS_EFFECTIVE_DATE)}
        </time>
        .
      </p>

      <Section title={whatItIs}>
        <p>
          Tramitico es una herramienta informativa. Ante una pregunta sobre
          impuestos o trámites de una persona que trabaja por cuenta propia en
          Costa Rica, busca en documentos oficiales del Ministerio de Hacienda y
          de la Caja Costarricense de Seguro Social, y redacta una respuesta que
          cita esos documentos, artículo por artículo, para que usted pueda
          verificarla en la fuente.
        </p>
        <p className="mt-4">
          Tramitico no resuelve, no dictamina y no sustituye a la institución.
          Lo que dice tiene el valor de la fuente que cita, y ninguno más.
        </p>
      </Section>

      <Section title={notAdvice}>
        <p>
          Cada respuesta lleva la misma advertencia:{" "}
          <em className="text-foreground">{DISCLAIMER}</em>
        </p>
        <p className="mt-4">
          Las normas y los documentos oficiales cambian, y una respuesta puede
          citar una versión que ya no es la vigente. Su situación particular
          puede diferir de la regla general que un documento describe. Antes de
          actuar sobre una respuesta, confírmela con la institución o con un
          profesional autorizado.
        </p>
      </Section>

      <Section title={noWarranty}>
        <p>
          El servicio se ofrece tal cual, en versión beta y sin garantía de
          ningún tipo. Puede estar fuera de servicio, puede responder con
          demora, puede declinar responder cuando no encuentra base oficial
          suficiente, y puede contener errores. Usted lo usa bajo su propia
          responsabilidad, y Tramitico no responde por decisiones tomadas a
          partir de lo que aquí se le muestra.
        </p>
      </Section>

      <Section title={acceptableUse}>
        <p>
          Cada persona dispone de una cuota diaria de preguntas: {anonLimit} sin
          sesión iniciada y {authedLimit} con sesión iniciada. El día se cuenta
          según el calendario de Costa Rica, y la cuota se reinicia a
          medianoche, hora local.
        </p>
        <p className="mt-4">
          No está permitido consultar el servicio de forma automatizada, extraer
          su contenido de manera sistemática, ni intentar eludir las cuotas o
          los mecanismos que las aplican.
        </p>
      </Section>

      <Section title={accounts}>
        <p>
          Puede usar Tramitico sin cuenta. Si inicia sesión, se guarda su
          historial de preguntas y respuestas hasta que usted lo elimine, y
          puede borrar la cuenta completa desde el menú de su correo. Qué se
          guarda, a quién se envía y cómo eliminarlo está descrito en la página
          de{" "}
          <Link href={PRIVACY_PATH} className="underline underline-offset-4">
            Privacidad
          </Link>
          , que forma parte de estos términos.
        </p>
      </Section>

      <Section title={changes}>
        <p>
          Estos términos pueden cambiar. La versión vigente es siempre la que
          está publicada en esta página, con su fecha de vigencia al inicio.
          Seguir usando el servicio después de un cambio implica aceptar la
          versión nueva.
        </p>
      </Section>

      <Section title={law}>
        <p>
          Estos términos se rigen por las leyes de la República de Costa Rica.
        </p>
      </Section>

      <Section title={contact}>
        <p>
          Para cualquier consulta sobre estos términos, escriba a{" "}
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
        Su dirección es{" "}
        <Link href={TERMS_PATH} className="underline underline-offset-4">
          tramitico.com{TERMS_PATH}
        </Link>
        . La política de privacidad está en{" "}
        <Link href={PRIVACY_PATH} className="underline underline-offset-4">
          Privacidad
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
