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
 * centred under the floating composer, one sentence that carries both facts
 * and the one link that backs them. The other site links (about, terms, code)
 * moved to the header and the colophon, so the note no longer reads as small
 * print: on a desktop it is a single line, on a phone two. On the landing the
 * colophon sits right under the note and already links the privacy page, so
 * the note drops its own link there (`linked={false}`) rather than say it twice.
 */

/** Where the full privacy statement lives. One constant; the page and the link agree. */
export const PRIVACY_PATH = "/privacidad";

export const PRIVACY_DISCLOSURE =
  "Sus preguntas se envían a proveedores de IA; con la sesión iniciada, " +
  "su historial se guarda hasta que usted lo elimine.";

export const PRIVACY_LINK_LABEL = "Privacidad";

/** Where the terms of use live (#326); linked from the colophon. */
export const TERMS_PATH = "/terminos";
export const TERMS_LINK_LABEL = "Términos";

/**
 * Where the about page lives (#328): what Tramitico is, how it answers, the
 * documents it answers from. Linked from the site header and the colophon.
 */
export const ACERCA_PATH = "/acerca";
export const ACERCA_LINK_LABEL = "Acerca";
/** The fragment of `/acerca` that lists the documents; the home caption links to it. */
export const ACERCA_SOURCES_ANCHOR = "fuentes";

export function PrivacyNote({ linked = true }: { linked?: boolean }) {
  return (
    <p
      data-slot="privacy-note"
      className="text-center text-[0.6875rem] leading-snug text-balance text-muted-foreground"
    >
      {PRIVACY_DISCLOSURE}
      {linked && (
        <>
          {" "}
          <Link
            href={PRIVACY_PATH}
            className="underline decoration-border underline-offset-4 transition-colors duration-150 ease-out-quart hover:text-foreground hover:decoration-current"
          >
            {PRIVACY_LINK_LABEL}
          </Link>
        </>
      )}
    </p>
  );
}
