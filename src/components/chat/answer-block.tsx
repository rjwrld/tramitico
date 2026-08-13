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
  markerOrdinalsFrom,
  messageText,
  statusFrom,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { renumberCitationMarkers } from "@/lib/answer/citations";
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
  // The [n] markers are the tracker's wire format, counted over chunks. The
  // streamed map rewrites them into the sello row's own numbering (#133), so
  // the prose can carry a superscript per claim and every one of them has a
  // stamp below to land on; a marker whose source is not (yet) in the
  // snapshot resolves to nothing and disappears, as it did under #75.
  const citations = citationsFrom(message);
  const text = renumberCitationMarkers(
    messageText(message),
    markerOrdinalsFrom(message),
    // Mid-stream the tail is whatever the last delta ended on — hide a
    // bracket run still being typed rather than flash "[1" as prose.
    { streaming: busy },
  );
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
      <AnswerProse
        text={text}
        references={{ count: citations.length, anchorPrefix: message.id }}
      />
      <SelloRow citations={citations} anchorPrefix={message.id} />
      {text !== "" && (
        <p className="text-xs text-muted-foreground italic">{DISCLAIMER}</p>
      )}
      <AskStatus state={statusState} />
    </div>
  );
}
