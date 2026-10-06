"use client";

/**
 * The Tier 1 seed prompts (SPEC Appendix A) as one-click seeded prompts —
 * one per family of the validated taxonomy (#254 Part B §B3, T1-A…T1-I),
 * rewritten in the vocabulary the demand research recorded (#264).
 *
 * Hairline pills, each opened by its institution (DESIGN §6). A transparent
 * pill with a mono «HACIENDA» or «CCSS» tag reads as a scoped action — ask
 * this, of that institution — where the earlier pills read as a tag cloud and
 * the rows (#478) as a wall of text. Two things keep it from becoming a cloud
 * again:
 *
 * - Short labels. A pill shows a short version of its question; the click
 *   still sends the full Appendix A question, which then heads the exchange,
 *   so nothing the reader is asking is hidden from them. The button's
 *   accessible name is that full question too.
 * - Five, then «Ver más preguntas (N)». The first `VISIBLE_SEEDS` pills show
 *   on every screen size, mixing Hacienda and CCSS; the disclosure reveals the
 *   rest in place. Hidden pills carry the `hidden` attribute, so they leave
 *   the accessibility tree as well as the layout.
 */
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Appendix A, in family order. Each is a question the corpus can answer to
 * the trust contract today — nothing here names a retired form (D-140), a
 * source that has not landed, or two unrelated changes in one breath.
 *
 * These exact strings are what a pill sends, and what `e2e/`, the chat tests
 * and `scripts/answer-latency-probe.ts` key on — change one only on purpose.
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

export type SeedQuestion = (typeof SEED_PROMPTS)[number];

export type Institution = "Hacienda" | "CCSS";

export interface SeedPill {
  /** What the click sends: an Appendix A question, verbatim. */
  question: SeedQuestion;
  /** What the pill shows: a short question in the same usted voice. */
  label: string;
  institution: Institution;
}

/**
 * Display order, which is not family order: the five most broadly useful
 * first — registering, the CCSS quota, the first invoice, whether to insure,
 * IVA on foreign clients — alternating the two institutions, then the
 * situational four behind the disclosure.
 */
export const SEED_PILLS: readonly SeedPill[] = [
  {
    question: SEED_PROMPTS[0],
    label: "¿Me inscribo si facturo al exterior?",
    institution: "Hacienda",
  },
  {
    question: SEED_PROMPTS[5],
    label: "¿Cuánto pago como independiente?",
    institution: "CCSS",
  },
  {
    question: SEED_PROMPTS[2],
    label: "¿Cómo emito mi primera factura?",
    institution: "Hacienda",
  },
  {
    question: SEED_PROMPTS[1],
    label: "¿Debo asegurarme si gano poco?",
    institution: "CCSS",
  },
  {
    question: SEED_PROMPTS[3],
    label: "¿Cobro IVA a clientes del exterior?",
    institution: "Hacienda",
  },
  {
    question: SEED_PROMPTS[4],
    label: "¿Cómo calculo el impuesto de renta?",
    institution: "Hacienda",
  },
  {
    question: SEED_PROMPTS[6],
    label: "¿Me pueden cobrar retroactivo?",
    institution: "CCSS",
  },
  {
    question: SEED_PROMPTS[7],
    label: "Dejé de trabajar, ¿cómo me salgo?",
    institution: "Hacienda",
  },
  {
    question: SEED_PROMPTS[8],
    label: "Me inscribí tarde, ¿qué me pasa?",
    institution: "Hacienda",
  },
];

/** How many pills show before the disclosure, on every screen size. */
export const VISIBLE_SEEDS = 5;

const HIDDEN_COUNT = SEED_PILLS.length - VISIBLE_SEEDS;

export const SHOW_MORE_LABEL = `Ver más preguntas (${HIDDEN_COUNT})`;
export const SHOW_LESS_LABEL = "Ver menos";

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
        {SEED_PILLS.map(({ question, label, institution }, index) => (
          <li key={question} hidden={index >= VISIBLE_SEEDS && !expanded}>
            {/* The accessible name is what the pill shows — tag and short
                label (WCAG 2.5.3, label in name); the click sends the full
                question, which then heads the exchange. */}
            <button
              type="button"
              disabled={disabled}
              onClick={() => onSelect(question)}
              className="flex items-center rounded-full border border-border py-1.5 pr-3.5 pl-1.5 text-left text-sm text-foreground transition-colors duration-150 ease-out-quart hover:border-[color-mix(in_oklch,var(--foreground)_28%,var(--border))] hover:bg-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 motion-reduce:transition-none pointer-coarse:min-h-11"
            >
              <span
                data-slot="seed-institution"
                className="mr-2.5 flex items-center self-stretch border-r border-border pr-2 pl-1.5 font-mono text-[0.6875rem] font-medium tracking-[0.04em] text-muted-foreground uppercase"
              >
                {institution}
              </span>{" "}
              <span className="text-pretty">{label}</span>
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={listId}
        onClick={() => setExpanded((value) => !value)}
        className="rounded-sm text-sm text-muted-foreground underline decoration-border underline-offset-4 transition-colors duration-150 hover:text-foreground hover:decoration-current focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:px-2"
      >
        {expanded ? SHOW_LESS_LABEL : SHOW_MORE_LABEL}
      </button>
    </div>
  );
}
