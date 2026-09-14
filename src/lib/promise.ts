/**
 * The product promise and the non-promise, as #254's decision record (Part A
 * §A2) states them — the long form, for the one page with room for it
 * (`/acerca`, #328). The chat's empty state says the same thing in two short
 * lines (`SCOPE_LINE` / `NON_PROMISE_LINE` in `chat.tsx`); both build on
 * `SCOPE_PHRASE` from routing, so the coverage claim is one string wherever
 * it is made.
 */
import { SCOPE_PHRASE } from "./routing";

/** The promise, one sentence. */
export const PROMISE_SENTENCE =
  `Tramitico responde en español llano las preguntas frecuentes sobre ${SCOPE_PHRASE} en Costa Rica, ` +
  "con cada afirmación citada al artículo oficial vigente, y dice claramente cuándo no puede responder.";

/** The non-promise, explicit in the UI and the README (#254). Order is the record's. */
export const NON_PROMISE_ITEMS = [
  "No cubre toda la ley tributaria ni «cualquier trámite del Estado».",
  "No calcula su impuesto ni su cuota exacta con sus datos; da la regla, la escala y un ejemplo cuando la fuente lo permite.",
  "No sustituye a un contador ni a Hacienda o la CCSS: no emite determinaciones personalizadas.",
  "No presenta declaraciones ni opera en TRIBU-CR o SICERE.",
  "No garantiza cobertura de sociedades, patronos, aduanas, MTSS ni municipalidades.",
  "Fuera de las familias de preguntas publicadas, una respuesta es «mejor esfuerzo citado» o una abstención.",
] as const;
