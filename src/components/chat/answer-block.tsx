/**
 * One assistant answer (DESIGN §6): card-free ink prose directly on the
 * ground, then the sello row, then the disclaimer as one quiet italic line.
 *
 * While the answer is on its way, this is also where the staged `data-status`
 * indicator lives (#72), rendered last: while there is no prose yet, the
 * block is otherwise empty so position doesn't matter; once the completion
 * summary flashes in after finish, appending it below the disclaimer means it
 * never displaces the answer that's already on screen. `busy` and
 * `completionText` are owned by `chat.tsx`, which is the one place that knows
 * whether *this* message is the actively-streaming one.
 *
 * #219 (DESIGN §8, amended moment 2): the answer arrives complete and
 * validated (#131/#169 kept full buffering), so what streams to the eye is a
 * client-paced reveal, not live token flow. `useWordReveal` below owns the
 * clock: hold «Verificando citas…» a beat, then fade the words in at
 * `REVEAL_WORDS_PER_SECOND`, and only when the last word has landed do the
 * sellos stamp, the disclaimer settle, and the completion line take its
 * moment. A message restored from history was never busy here, so it renders
 * whole, instantly — the reveal belongs to the exchange, not the text.
 */
import * as React from "react";

import {
  citationsFrom,
  DEGRADED_SEARCH_NOTE,
  degradedFrom,
  markerOrdinalsFrom,
  messageText,
  routedFrom,
  statusFrom,
  type AskUIMessage,
} from "@/lib/answer/contract";
import { routingEntriesFor, type RoutedCategory } from "@/lib/routing";
import { renumberCitationMarkers } from "@/lib/answer/citations";
import { AnswerProse } from "@/components/chat/answer-prose";
import { AskStatus, type AskStatusState } from "@/components/chat/ask-status";
import { SelloRow } from "@/components/sello";
import { prefersReducedMotion } from "@/lib/utils";

export const DISCLAIMER =
  "No es asesoría legal ni contable — verifique con Hacienda.";

/** Lead-in of the routed decline's link row (#264). */
export const ROUTED_LINKS_LABEL = "Fuente oficial:";

/** The reveal cadence the #169/#219 prototypes settled on. */
const REVEAL_WORDS_PER_SECOND = 120;
const REVEAL_TOKEN_MS = 1000 / REVEAL_WORDS_PER_SECOND;
/**
 * Minimum time «Verificando citas…» stays on screen before the first word
 * (#219): the server-side check takes microseconds, so legibility is the
 * client's job. Also the catch-up rule's whole story today: delays are
 * computed against a fixed start time, so any token that arrives after its
 * slot fades immediately — the reveal can trail the buffer, never the
 * other way around, and the trail is bounded by the schedule itself.
 */
const VERIFY_HOLD_MS = 400;
/** Keep in sync with `--animate-word-fade` (globals.css). */
const WORD_FADE_MS = 200;
/**
 * How long the completion summary sits in the status region (#72 req 3: it
 * announces, "then clears visually") before it unmounts. Long enough for a
 * screen reader to have started reading a one-sentence announcement; short
 * enough that it reads as a moment, not a lingering banner. It lives here
 * rather than in chat.tsx since #219: the moment starts when the summary is
 * actually shown — after the reveal — not when the stream finished.
 */
const COMPLETION_DISPLAY_MS = 3000;

type RevealPhase =
  /** Live exchange, no prose yet — the stage label owns the screen. */
  | "pending"
  /** Prose exists; «Verificando…» is having its legibility beat. */
  | "holding"
  /** Words are fading in on the schedule. */
  | "revealing"
  /** Everything visible — sellos, disclaimer and completion may show. */
  | "done";

/**
 * The #219 reveal clock. Armed by the first prose of a live exchange; a
 * message that mounts with its text already final (history, or any render
 * where `busy` was never true) is `done` from the start.
 *
 * `delayFor` memoizes per token index, which is what makes the schedule
 * stable across re-renders: a token's delay is computed once, on the render
 * where it first appears, as time-remaining-until-its-slot — re-rendering
 * never restarts an animation, and a token that arrives past its slot gets
 * `0` (the catch-up).
 */
function useWordReveal(text: string, busy: boolean) {
  const [phase, setPhase] = React.useState<RevealPhase>(() =>
    busy ? "pending" : "done",
  );
  const startRef = React.useRef<number | null>(null);
  const delaysRef = React.useRef<number[]>([]);
  /**
   * When the latest-scheduled token starts its fade, in epoch ms. The
   * close-out effect ends the reveal at this plus the fade — measured off the
   * delays actually handed out, so it cannot disagree with what AnswerProse
   * rendered (a naive re-count of `text` would: markers and bold runs make
   * the rendered token stream longer than a whitespace split).
   */
  const lastFadeStartRef = React.useRef(0);

  // Arm on the first prose of a live exchange, or resolve `pending` to
  // `done` outright (reduced motion; an exchange that ended before any
  // prose). Render-time derived-state adjustments, not effects — the
  // remaining transitions are genuinely time-driven and live in the two
  // timer effects below.
  if (phase === "pending" && (text !== "" || !busy)) {
    if (busy && text !== "" && !prefersReducedMotion()) {
      setPhase("holding");
    } else {
      setPhase("done");
    }
  }

  React.useEffect(() => {
    if (phase !== "holding") return;
    // `startRef` is set by the first `delayFor` call, which happens during
    // the render that committed before this effect — the fallback only fires
    // for the degenerate answer that renders no fade token at all (e.g. its
    // only content was an unresolvable marker), where there is nothing to
    // hold for.
    const timer = setTimeout(
      () => setPhase("revealing"),
      Math.max(0, (startRef.current ?? Date.now()) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [phase]);

  // Close out once the exchange is over and the full text is in hand: the
  // reveal is done when the last fade actually scheduled has finished. `text`
  // stays a dependency so tokens that arrive after `busy` flips still extend
  // the deadline (their render precedes this effect's re-run).
  React.useEffect(() => {
    if (busy || phase === "pending" || phase === "done") return;
    const end = lastFadeStartRef.current + WORD_FADE_MS;
    const timer = setTimeout(
      () => setPhase("done"),
      Math.max(0, end - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [busy, phase, text]);

  const delayFor = React.useCallback((index: number): number => {
    const cached = delaysRef.current[index];
    if (cached !== undefined) return cached;
    // Lazy clock start (write-once, like a ref's lazy init): the first token
    // ever asked for — during the first "holding" render, which always
    // precedes the timer effects — opens the schedule at now + the hold.
    const now = Date.now();
    startRef.current ??= now + VERIFY_HOLD_MS;
    const delay = Math.max(0, startRef.current + index * REVEAL_TOKEN_MS - now);
    delaysRef.current[index] = delay;
    // The token's fade starts `delay` from now — its slot, or immediately
    // for a token that arrived past its slot (the catch-up).
    lastFadeStartRef.current = Math.max(lastFadeStartRef.current, now + delay);
    return delay;
  }, []);

  return { phase, delayFor };
}

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
  const { phase, delayFor } = useWordReveal(text, busy);
  const revealDone = phase === "done";

  // The completion summary's display window (#72 req 3, timed from actual
  // display since #219 — see COMPLETION_DISPLAY_MS). "Spent" is keyed by the
  // summary text itself, so a fresh exchange's summary shows even if the
  // state variable still carries the previous one's value.
  const [spentFor, setSpentFor] = React.useState<string | null>(null);
  const showCompletion =
    completionText !== null && revealDone && spentFor !== completionText;
  React.useEffect(() => {
    if (!showCompletion) return;
    const timer = setTimeout(
      () => setSpentFor(completionText),
      COMPLETION_DISPLAY_MS,
    );
    return () => clearTimeout(timer);
  }, [showCompletion, completionText]);

  // Whether this answer came out of lexical-only retrieval (#127). Sticky
  // for the life of the message: the route writes the part before any text,
  // and a restored history message simply never carries one.
  const degraded = degradedFrom(message);
  // Which institution an honest decline was routed to (#264). Same
  // lifecycle as `degraded`: written before the text, absent on a restored
  // message (whose text still carries the URL as plain words).
  const routed = routedFrom(message);
  // The stage label is this message's business until its first word is
  // actually visible (#219): before any prose, and through the «Verificando
  // citas…» hold that sits between the last stage snapshot and the first
  // fade — the first revealed word retires it, as the first delta did
  // before buffering. A historical message never reports a stage at all.
  const stage =
    busy && (phase === "pending" || phase === "holding")
      ? statusFrom(message)
      : null;
  const statusState: AskStatusState | null = stage
    ? { kind: "stage", stage }
    : showCompletion
      ? { kind: "complete", text: completionText }
      : null;
  return (
    <div data-slot="answer" className="flex flex-col gap-4" aria-busy={busy}>
      <AnswerProse
        text={text}
        references={{ count: citations.length, anchorPrefix: message.id }}
        reveal={
          phase === "holding" || phase === "revealing" ? { delayFor } : null
        }
      />
      {/*
        The sellos stamp only once the reveal has delivered the words they
        certify (#219): the wait animation hands off to the signature stamp
        settle instead of competing with it mid-reveal. Same gate for the
        notes below — they qualify an answer the reader can now actually read.
      */}
      {revealDone && (
        <SelloRow citations={citations} anchorPrefix={message.id} />
      )}
      {/*
        The degraded-search label (#127 req. 3). Quiet, above the disclaimer,
        and only once there is an answer to qualify — before then, the status
        line owns the moment. Not an error and not red: what is below it is a
        real answer with real sellos, it just came out of a thinner search.
        Which is why it is muted text and not an `Alert` — DESIGN §10 keeps
        red to its four sanctioned places, and a boxed warning over a good
        answer overstates what happened.
      */}
      {revealDone && text !== "" && degraded && (
        <p data-slot="degraded-note" className="text-xs text-muted-foreground">
          {DEGRADED_SEARCH_NOTE}
        </p>
      )}
      {/*
        The routed decline's link row (#264). The decline's prose already
        names the institution and prints its URL as words — this is the
        same destination as a real link, and it is the one href on an
        answer besides the citation reference: it comes from the routing
        table in code, never from the streamed text (SPEC §8). Sits where
        the sellos would, since it is what the decline has instead of them.
      */}
      {revealDone && text !== "" && routed !== null && (
        <RoutedLinks category={routed} />
      )}
      {revealDone && text !== "" && (
        <p className="text-xs text-muted-foreground italic">{DISCLAIMER}</p>
      )}
      <AskStatus state={statusState} />
    </div>
  );
}

/**
 * The institution(s) a decline points at, as links. One for a routed
 * category, two (Hacienda, CCSS) for the general decline. Quiet — the same
 * meta size as the notes around it — and `rel="noopener"` since every
 * destination is another organisation's site.
 */
function RoutedLinks({ category }: { category: RoutedCategory }) {
  const entries = routingEntriesFor(category);
  return (
    <p data-slot="routed-links" className="text-xs text-muted-foreground">
      {ROUTED_LINKS_LABEL}{" "}
      {entries.map((entry, index) => (
        <React.Fragment key={entry.category}>
          {index > 0 && " · "}
          <a
            href={entry.url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4"
          >
            {entry.institution}
          </a>
        </React.Fragment>
      ))}
    </p>
  );
}
