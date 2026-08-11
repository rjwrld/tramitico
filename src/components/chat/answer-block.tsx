/**
 * One assistant answer (DESIGN §6): card-free ink prose directly on the
 * ground, then the sello row, then the disclaimer as one quiet italic line.
 * The sellos stamp in as `data-citations` snapshots stream (#21 contract).
 *
 * While the answer is still on its way, this is also where the staged
 * `data-status` indicator lives (#72), rendered last: while there is no
 * prose yet, the block is otherwise empty so position doesn't matter; once
 * the completion summary flashes in after finish, appending it below the
 * disclaimer means it never displaces the answer that's already on screen.
 * `busy` and `completionText` are owned by `chat.tsx`, which is the one place
 * that knows whether *this* message is the actively-streaming one.
 */
import {
  citationsFrom,
  messageText,
  statusFrom,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { stripCitationMarkers } from "@/lib/answer/citations";
import { AnswerProse } from "@/components/chat/answer-prose";
import { AskStatus, type AskStatusState } from "@/components/chat/ask-status";
import { SelloRow } from "@/components/sello";

export const DISCLAIMER =
  "No es asesoría legal ni contable — verifique con Hacienda.";

export function AnswerBlock({
  message,
  busy = false,
  completionText = null,
}: {
  message: AskUIMessage;
  /** Whether this is the last message and the exchange is still in flight. */
  busy?: boolean;
  /** Set once, right after this message's exchange finishes successfully. */
  completionText?: string | null;
}) {
  // The [n] markers are the tracker's wire format — sellos are how a citation
  // shows up here, so the prose renders without them (issue #75).
  const text = stripCitationMarkers(messageText(message));
  const citations = citationsFrom(message);
  // The stage label is only ever this message's business while it is both
  // the active one and has no prose yet — the first text delta retires it
  // (req 4), and a historical message never reports a stage at all.
  const stage = busy && text === "" ? statusFrom(message) : null;
  const statusState: AskStatusState | null = stage
    ? { kind: "stage", stage }
    : completionText
      ? { kind: "complete", text: completionText }
      : null;
  return (
    <div data-slot="answer" className="flex flex-col gap-4" aria-busy={busy}>
      <AnswerProse text={text} />
      <SelloRow citations={citations} />
      {text !== "" && (
        <p className="text-xs text-muted-foreground italic">{DISCLAIMER}</p>
      )}
      <AskStatus state={statusState} />
    </div>
  );
}
