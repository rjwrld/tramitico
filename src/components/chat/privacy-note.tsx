import Link from "next/link";

/**
 * The pre-submission disclosure (#136 req. 2, privacy contract from #121).
 *
 * Someone types a question about their own tax situation into a box; before
 * they press "Enviar" they are owed two facts they cannot infer from the
 * screen — that the question leaves for a model provider, and that signing in
 * means it is kept. So this sits under the composer, in both the empty state
 * and the conversation, and it is there *before* the first ask rather than in
 * a footer nobody scrolls to.
 *
 * Quiet, like the answer disclaimer it rhymes with (DESIGN §9: "always
 * present, always quiet, never a modal") — 11px muted (DESIGN §3's meta size),
 * snug leading, one paragraph of prose, and the link to the full page carries
 * the only emphasis. Both facts stay visible; the size and leading are what
 * keep the note to three lines on a phone, inside the pinned composer bar.
 */

/** Where the full privacy statement lives. One constant; the page and the link agree. */
export const PRIVACY_PATH = "/privacidad";

export const PRIVACY_DISCLOSURE =
  "Sus preguntas se envían a proveedores de inteligencia artificial para poder responderlas. " +
  "Con la sesión iniciada, su historial se guarda hasta que usted lo elimine.";

export const PRIVACY_LINK_LABEL = "Ver cómo se tratan sus datos";

/**
 * Where the terms of use live (#326). They ride along here because this note
 * is the one place the app links `/privacidad`, and the two pages belong side
 * by side; the note stays one paragraph, three lines on a phone.
 */
export const TERMS_PATH = "/terminos";
export const TERMS_LINK_LABEL = "Términos de uso";

/**
 * Where the about page lives (#328): what Tramitico is, how it answers, the
 * documents it answers from, who made it. First of the three links, because
 * it is the one a first-time visitor is most likely to want.
 */
export const ACERCA_PATH = "/acerca";
export const ACERCA_LINK_LABEL = "Acerca";
/** The fragment of `/acerca` that lists the documents; the home caption links to it. */
export const ACERCA_SOURCES_ANCHOR = "fuentes";

export function PrivacyNote() {
  return (
    <p
      data-slot="privacy-note"
      className="text-[0.6875rem] leading-snug text-pretty text-muted-foreground"
    >
      {PRIVACY_DISCLOSURE}{" "}
      <Link href={ACERCA_PATH} className="underline underline-offset-4">
        {ACERCA_LINK_LABEL}
      </Link>
      {" · "}
      <Link href={PRIVACY_PATH} className="underline underline-offset-4">
        {PRIVACY_LINK_LABEL}
      </Link>
      {" · "}
      <Link href={TERMS_PATH} className="underline underline-offset-4">
        {TERMS_LINK_LABEL}
      </Link>
      .
    </p>
  );
}
