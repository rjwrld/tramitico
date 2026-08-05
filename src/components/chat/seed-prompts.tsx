/**
 * The top-10 pain questions (SPEC Appendix A) as one-click seeded prompts.
 * Pill chips — full radius is sanctioned here (DESIGN §6): they are actions,
 * not documents.
 */
import { cn } from "@/lib/utils";

export const SEED_PROMPTS = [
  "¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?",
  "¿Debo cobrar IVA en facturas a clientes fuera de Costa Rica?",
  "¿Cuál código CABYS uso para desarrollo de software?",
  "¿Cuánto pago a la CCSS como trabajador independiente y cómo se calcula la base?",
  "¿Me pueden cobrar retroactivo si nunca me inscribí en la CCSS?",
  "¿Cómo emito factura electrónica y qué cambió con v4.4 / TRIBU-CR?",
  "¿Qué pasa si dejo de trabajar independiente — desinscripción D-140 y consecuencias?",
  "¿Cómo calculo renta como persona física con actividad lucrativa — aplica la deducción automática del 25%?",
  "¿Régimen simplificado o tradicional siendo programador? (RTS excluye profesionales liberales)",
  "¿Con TRIBU-CR, cambió el procedimiento para declarar/pagar? ¿Dónde entro ahora?",
] as const;

export function SeedPrompts({
  onSelect,
  disabled = false,
  className,
}: {
  onSelect: (question: string) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <ul
      aria-label="Preguntas frecuentes"
      className={cn(
        "flex list-none flex-wrap justify-center gap-2 p-0",
        className,
      )}
    >
      {SEED_PROMPTS.map((question) => (
        <li key={question}>
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
  );
}
