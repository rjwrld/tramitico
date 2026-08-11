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
import { stripCitationMarkers } from "@/lib/answer/citations";
import { AnswerProse } from "@/components/chat/answer-prose";
import { SelloRow } from "@/components/sello";

export const DISCLAIMER =
  "No es asesoría legal ni contable — verifique con Hacienda.";

export function AnswerBlock({ message }: { message: AskUIMessage }) {
  // The [n] markers are the tracker's wire format — sellos are how a citation
  // shows up here, so the prose renders without them (issue #75).
  const text = stripCitationMarkers(messageText(message));
  const citations = citationsFrom(message);
  return (
    <div data-slot="answer" className="flex flex-col gap-4">
      <AnswerProse text={text} />
      <SelloRow citations={citations} />
      {text !== "" && (
        <p className="text-xs text-muted-foreground italic">{DISCLAIMER}</p>
      )}
    </div>
  );
}
