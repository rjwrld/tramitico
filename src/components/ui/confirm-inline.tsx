// Inline destructive confirm (issue #110): the one confirm shape shared by
// the history-item delete and the account delete. DESIGN §2 red discipline —
// an explicit-verb button in the tinted `destructive` variant (ground
// `--destructive-bg`, not the brand red fill), never a browser confirm(). The
// container itself stays transparent: the prompt copy reads on whichever
// surface it lands on — the page in the sidebar, the popover in the account
// menu — and issue #160 raised dark `--destructive` until both clear AA
// (5.68:1 and 5.13:1). The rule that delineates the zone is its own
// `--destructive-border` token for the same reason: as an alpha
// (`border-destructive/30`) it measured 1.81:1 light / 1.58:1 dark against
// those surfaces, under the 3:1 WCAG 1.4.11 floor for non-text UI (issue
// #165). See `src/lib/design/tokens.test.ts`.
// The element is polymorphic
// via `render` because one call site is a list item and the other sits inside a
// menu.
//
// Radius is the shared `rounded-lg` token (`--radius: 0.25rem`, DESIGN §1's
// "sharp, document-like") for both call sites — issue #116 retired the
// menu-side `rounded-md` override. `className` is for call-site spacing and
// layout: `cn` is last-wins, so a radius passed here would still silently beat
// the default. Nothing enforces that but this note and the tests below.
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
          "flex flex-col gap-2 rounded-lg border border-destructive-border p-2",
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
