/**
 * One assistant answer (DESIGN §6): card-free ink prose directly on the
 * ground, then the sello row, then the disclaimer as one quiet italic line.
 * The sellos stamp in as `data-citations` snapshots stream (#21 contract).
 */
import {
  citationsFrom,
  messageText,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { SelloRow } from "@/components/sello";

export const DISCLAIMER =
  "No es asesoría legal ni contable — verifique con Hacienda.";

export function AnswerBlock({ message }: { message: AskUIMessage }) {
  const text = messageText(message);
  const citations = citationsFrom(message);
  return (
    <div data-slot="answer" className="flex flex-col gap-4">
      <div className="max-w-[68ch] text-base leading-[1.7] text-pretty whitespace-pre-wrap">
        {text}
      </div>
      <SelloRow citations={citations} />
      {text !== "" && (
        <p className="text-xs text-muted-foreground italic">{DISCLAIMER}</p>
      )}
    </div>
  );
}
