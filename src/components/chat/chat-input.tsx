/**
 * The ask box. "Enviar" is the view's single filled primary action
 * (DESIGN §6 / red discipline). Enter submits; Shift+Enter breaks a line.
 *
 * While a stream is in flight, "Enviar" has nothing left to do — this issue
 * (#74, req 1) swaps it for "Detener" in the same slot rather than showing
 * both: outline variant (never the filled primary), verb-first, wired
 * straight to `useChat`'s `stop()`. One action lives in this slot at a time.
 *
 * The privacy disclosure (#136 req. 2) rides along under the field rather
 * than being placed by each caller: this component is the composer, it is
 * mounted in both the empty state and the conversation, and the one thing the
 * disclosure has to be is present *before* the first ask.
 *
 * Touch targets: on a coarse pointer the field and its button grow to 44px
 * (the HIG floor; WCAG 2.5.8 only asks 24). Keyed on `pointer-coarse`, not a
 * viewport width — a narrow desktop window keeps the 40px control, a tablet
 * in landscape gets the touch size. On a fine pointer the button matches the
 * field's 40px rather than the 32px button default, so the two read as one
 * control. The placeholder is short on purpose: the longer "…sobre impuestos
 * o trámites" wrapped to two lines at 375px and made the empty field 66px
 * tall before anyone typed; the headline above already names the scope.
 *
 * The length cap: the route turns a question past `MAX_QUESTION_LENGTH`
 * away as `invalid_question`, and a long paste used to learn that only after
 * it was sent. So the composer counts what it will send (the trimmed text,
 * in the route's own `String.length` units): a counter appears as the cap
 * nears, and past it a line says what to do and "Enviar" — the button and
 * Enter both — holds the question until it is shorter. Nothing is cut: a
 * `maxLength` would silently drop the end of a paste. The line is ink, never
 * red (DESIGN §2 polices red); mono and tabular, as figures are (§3). For
 * the same reason the field takes no `aria-invalid`, which the Textarea
 * primitive paints with the destructive border: the count is the field's
 * description, and crossing the cap is announced once. The field grows with
 * its text only up to `max-h-40` and scrolls past that: a long paste used to
 * grow it past a phone's viewport, pushing "Enviar" and the count off-screen.
 */
import * as React from "react";
import { PrivacyNote } from "@/components/chat/privacy-note";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MAX_QUESTION_LENGTH } from "@/lib/answer/contract";
import { cn } from "@/lib/utils";

/** The counter shows from here: near enough the cap for the count to matter. */
export const LENGTH_COUNTER_FROM = MAX_QUESTION_LENGTH - 100;

/** Beside the count once the question is over the cap (DESIGN §9: what to do). */
export const QUESTION_TOO_LONG_HINT = "Acorte la pregunta para enviarla.";

/**
 * What a screen reader hears once, as the question crosses the cap. The count
 * itself stays out of the live region, so it is not read on every keystroke;
 * it is the field's description instead.
 */
export const QUESTION_TOO_LONG_ANNOUNCEMENT = `La pregunta pasa de ${MAX_QUESTION_LENGTH} caracteres. Acórtela para enviarla.`;

/** What `Chat` can do to the composer from outside it (#436). */
export interface ChatInputHandle {
  /**
   * Puts a question back in the field, focused, for the reader to edit — the
   * recovery for a question whose own text failed (`rephrase`: the search
   * could not use it, or the route turned it away as invalid). A
   * draft the reader has already started typing is kept instead: it is newer
   * than the question that failed.
   */
  restore: (text: string) => void;
}

export function ChatInput({
  ref,
  onSubmit,
  onStop,
  busy = false,
  focusOnMount = false,
}: {
  ref?: React.Ref<ChatInputHandle>;
  onSubmit: (question: string) => void;
  /** Stops the in-flight stream (#74). Only ever invoked while `busy`. */
  onStop: () => void;
  busy?: boolean;
  /**
   * #138: the empty state's composer is a different element from the
   * conversation's, so submitting the first question unmounts the one the
   * keyboard user was standing on and drops focus to `<body>`. The composer
   * that replaces it takes focus, which is where they already were.
   */
  focusOnMount?: boolean;
}) {
  const [question, setQuestion] = React.useState("");
  const field = React.useRef<HTMLTextAreaElement>(null);
  const counterId = React.useId();
  const length = question.trim().length;
  const counted = length >= LENGTH_COUNTER_FROM;
  const tooLong = length > MAX_QUESTION_LENGTH;

  React.useEffect(() => {
    if (focusOnMount) field.current?.focus();
  }, [focusOnMount]);

  React.useImperativeHandle(
    ref,
    () => ({
      restore: (text) => {
        setQuestion((current) => (current.trim() === "" ? text : current));
        field.current?.focus();
      },
    }),
    [],
  );

  const submit = () => {
    const trimmed = question.trim();
    if (trimmed === "" || trimmed.length > MAX_QUESTION_LENGTH || busy) return;
    onSubmit(trimmed);
    setQuestion("");
  };

  return (
    <div className="flex flex-col gap-2">
      <form
        className="flex items-end gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Textarea
          ref={field}
          name="question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Escriba su pregunta…"
          aria-label="Su pregunta"
          aria-describedby={counted ? counterId : undefined}
          rows={1}
          className="max-h-40 min-h-10 resize-none overflow-y-auto pointer-coarse:min-h-11"
        />
        {busy ? (
          <Button
            type="button"
            variant="outline"
            className="h-10 px-4 pointer-coarse:h-11"
            onClick={onStop}
          >
            Detener
          </Button>
        ) : (
          <Button
            type="submit"
            className="h-10 px-4 pointer-coarse:h-11"
            disabled={length === 0 || tooLong}
          >
            Enviar
          </Button>
        )}
      </form>
      {counted && (
        <p
          id={counterId}
          className={cn(
            "text-[0.6875rem] leading-snug text-muted-foreground",
            tooLong && "text-foreground",
          )}
        >
          <span className="font-mono tabular-nums">
            {length} / {MAX_QUESTION_LENGTH}
          </span>
          {tooLong && <> · {QUESTION_TOO_LONG_HINT}</>}
        </p>
      )}
      <p aria-live="polite" className="sr-only">
        {tooLong ? QUESTION_TOO_LONG_ANNOUNCEMENT : ""}
      </p>
      <PrivacyNote />
    </div>
  );
}
