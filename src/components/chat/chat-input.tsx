/**
 * The ask box. "Enviar" is the view's single filled primary action
 * (DESIGN §6 / red discipline). Enter submits; Shift+Enter breaks a line.
 *
 * While a stream is in flight, "Enviar" has nothing left to do — this issue
 * (#74, req 1) swaps it for "Detener" in the same slot rather than showing
 * both: outline variant (never the filled primary), verb-first, wired
 * straight to `useChat`'s `stop()`. One action lives in this slot at a time.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({
  onSubmit,
  onStop,
  busy = false,
  focusOnMount = false,
}: {
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

  const submit = () => {
    const trimmed = question.trim();
    if (trimmed === "" || busy) return;
    onSubmit(trimmed);
    setQuestion("");
  };

  return (
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
        placeholder="Escriba su pregunta sobre impuestos o trámites…"
        aria-label="Su pregunta"
        rows={1}
        className="min-h-10 resize-none"
      />
      {busy ? (
        <Button type="button" variant="outline" onClick={onStop}>
          Detener
        </Button>
      ) : (
        <Button type="submit" disabled={question.trim() === ""}>
          Enviar
        </Button>
      )}
    </form>
  );
}
