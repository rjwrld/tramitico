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
 * viewport width — a narrow desktop window keeps the 32px control, a tablet
 * in landscape gets the touch size. The placeholder is short on purpose: the
 * longer "…sobre impuestos o trámites" wrapped to two lines at 375px and
 * made the empty field 66px tall before anyone typed; the headline above
 * already names the scope.
 */
import * as React from "react";
import { PrivacyNote } from "@/components/chat/privacy-note";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

/** What `Chat` can do to the composer from outside it (#436). */
export interface ChatInputHandle {
  /**
   * Puts a question back in the field, focused, for the reader to edit — the
   * recovery for a question whose own text the search could not use. A
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
    if (trimmed === "" || busy) return;
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
          rows={1}
          className="min-h-10 resize-none pointer-coarse:min-h-11"
        />
        {busy ? (
          <Button
            type="button"
            variant="outline"
            className="pointer-coarse:h-11"
            onClick={onStop}
          >
            Detener
          </Button>
        ) : (
          <Button
            type="submit"
            className="pointer-coarse:h-11"
            disabled={question.trim() === ""}
          >
            Enviar
          </Button>
        )}
      </form>
      <PrivacyNote />
    </div>
  );
}
