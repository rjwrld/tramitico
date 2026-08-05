/**
 * The ask box. "Enviar" is the view's single filled primary action
 * (DESIGN §6 / red discipline). Enter submits; Shift+Enter breaks a line.
 */
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function ChatInput({
  onSubmit,
  busy = false,
}: {
  onSubmit: (question: string) => void;
  busy?: boolean;
}) {
  const [question, setQuestion] = React.useState("");

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
      <Button type="submit" disabled={busy || question.trim() === ""}>
        Enviar
      </Button>
    </form>
  );
}
