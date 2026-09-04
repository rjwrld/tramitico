"use client";

/**
 * The Tier 1 seed prompts (SPEC Appendix A) as one-click seeded prompts —
 * one per family of the validated taxonomy (#254 Part B §B3, T1-A…T1-I),
 * rewritten in the vocabulary the demand research recorded (#264). Pill
 * chips — full radius is sanctioned here (DESIGN §6): they are actions, not
 * documents.
 *
 * On a phone the nine chips stack full-width and run past the composer and
 * the fold. Below `md` only the first `VISIBLE_ON_PHONE` show; "Ver N
 * preguntas más" discloses the rest in place. The cut is CSS
 * (`hidden md:block`), so a wider viewport always shows all nine and the
 * toggle itself is gone there — nothing to keep in sync with a breakpoint in
 * JS.
 */
import * as React from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Appendix A, in family order. Each is a question the corpus can answer to
 * the trust contract today — nothing here names a retired form (D-140), a
 * source that has not landed, or two unrelated changes in one breath.
 */
export const SEED_PROMPTS = [
  // T1-A — Inscripción en Hacienda
  "¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?",
  // T1-B — Obligación y afiliación CCSS
  "¿Estoy obligado a asegurarme en la Caja si gano poco?",
  // T1-C — Comprobantes electrónicos
  "¿Cómo emito mi primera factura electrónica y qué código CABYS uso?",
  // T1-D — IVA para servicios
  "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
  // T1-E — Renta de la actividad
  "¿Cómo calculo el impuesto sobre la renta como persona física con actividad lucrativa y qué gastos puedo deducir?",
  // T1-F — Cuota CCSS
  "¿Cuánto pago a la CCSS como trabajador independiente y cómo se calcula la base?",
  // T1-G — Retroactivo y prescripción
  "¿Me pueden cobrar retroactivo si nunca me inscribí en la CCSS?",
  // T1-H — Cierre y desinscripción
  "Dejé de trabajar por mi cuenta, ¿cómo me salgo de Hacienda?",
  // T1-I — Sanciones básicas
  "Me inscribí un año tarde, ¿qué me pasa?",
] as const;

/** How many chips a phone shows before the disclosure. */
export const VISIBLE_ON_PHONE = 5;

const HIDDEN_COUNT = SEED_PROMPTS.length - VISIBLE_ON_PHONE;

export const SHOW_MORE_LABEL = `Ver ${HIDDEN_COUNT} preguntas más`;
export const SHOW_LESS_LABEL = "Ver menos preguntas";

export function SeedPrompts({
  onSelect,
  disabled = false,
  className,
}: {
  onSelect: (question: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const listId = React.useId();

  return (
    <div className={cn("flex flex-col items-center gap-3", className)}>
      <ul
        id={listId}
        aria-label="Preguntas frecuentes"
        className="flex list-none flex-wrap justify-center gap-2 p-0"
      >
        {SEED_PROMPTS.map((question, index) => (
          <li
            key={question}
            className={cn(
              index >= VISIBLE_ON_PHONE && !expanded && "hidden md:block",
            )}
          >
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(question)}
              className="rounded-full border border-border bg-secondary px-3 py-1.5 text-left text-sm text-secondary-foreground transition-colors duration-150 hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50"
            >
              {question}
            </button>
          </li>
        ))}
      </ul>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="pointer-coarse:h-11 md:hidden"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? SHOW_LESS_LABEL : SHOW_MORE_LABEL}
      </Button>
    </div>
  );
}
