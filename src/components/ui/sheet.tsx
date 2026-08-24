"use client";

/**
 * A side panel over the ground — the phone-sized home for a surface that is a
 * sidebar on desktop (issue #138). Base UI's Dialog does the work that makes
 * it operable: focus trap, Esc to close, scroll lock, focus returned to the
 * trigger.
 *
 * Deliberately motionless. DESIGN §8 spends the motion budget on exactly three
 * moments (stamp settle, streaming text, theme crossfade), so this one opens
 * and closes instantly rather than sliding — nothing to give a
 * `prefers-reduced-motion` alternative to. Z-index per DESIGN §7: backdrop 30,
 * modal 40.
 */

import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import { X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function Sheet(props: DialogPrimitive.Root.Props) {
  return <DialogPrimitive.Root {...props} />;
}

function SheetTrigger(props: DialogPrimitive.Trigger.Props) {
  return <DialogPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: DialogPrimitive.Close.Props) {
  return <DialogPrimitive.Close data-slot="sheet-close" {...props} />;
}

/**
 * The panel itself, anchored to the inline start. `aria-label` is required
 * rather than optional: the panel is a dialog, and a dialog without a name is
 * an unannounced one. So is `closeLabel` — Base UI asks for a `Close` inside a
 * modal popup so a touch screen reader has a way out, and that button needs a
 * name of its own.
 */
function SheetContent({
  className,
  children,
  closeLabel,
  ...props
}: DialogPrimitive.Popup.Props & {
  "aria-label": string;
  closeLabel: string;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop
        data-slot="sheet-backdrop"
        className="fixed inset-0 z-30 bg-foreground/20"
      />
      <DialogPrimitive.Popup
        data-slot="sheet-content"
        className={cn(
          "fixed inset-y-0 start-0 z-40 flex w-[min(20rem,85vw)] flex-col border-e bg-background",
          // Notched devices: the panel spans the full height and touches the
          // inline start edge, so it owns those insets itself.
          "ps-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)]",
          className,
        )}
        {...props}
      >
        <SheetClose
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={closeLabel}
              className="absolute end-2 top-2"
            />
          }
        >
          <X />
        </SheetClose>
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  );
}

export { Sheet, SheetClose, SheetContent, SheetTrigger };
