// Inline destructive confirm (issue #110): the one confirm shape shared by
// the history-item delete and the account delete. DESIGN §2 red discipline —
// an explicit-verb filled destructive button inside a tinted block, never a
// browser confirm(). The element is polymorphic via `render` because one call
// site is a list item and the other sits inside a menu.
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConfirmInlineProps extends useRender.ComponentProps<"div"> {
  /** What the confirm destroys, stated plainly (DESIGN §9: no apology theater). */
  prompt: string;
  /** Explicit verb for the destructive button — never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  disabled?: boolean;
}

function ConfirmInline({
  prompt,
  confirmLabel,
  onConfirm,
  onCancel,
  disabled = false,
  className,
  render,
  ...props
}: ConfirmInlineProps) {
  return useRender({
    defaultTagName: "div",
    props: mergeProps<"div">(
      {
        className: cn(
          "flex flex-col gap-2 rounded-lg border border-destructive/30 p-2",
          className,
        ),
        children: (
          <>
            <p className="text-xs text-destructive">{prompt}</p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                size="xs"
                disabled={disabled}
                onClick={onConfirm}
              >
                {confirmLabel}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                disabled={disabled}
                onClick={onCancel}
              >
                Cancelar
              </Button>
            </div>
          </>
        ),
      },
      props,
    ),
    render,
    state: {
      slot: "confirm-inline",
    },
  });
}

export { ConfirmInline };
