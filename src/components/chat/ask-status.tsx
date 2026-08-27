/**
 * Staged progress for /api/ask (issue #72, reshaped by #219). #71 made the
 * route stream-first (ADR 0009): the first byte arrives in milliseconds, so
 * this renders the server's own `data-status` snapshots — `statusFrom(message)`
 * from the #71 contract — in an accessible `role="status"` region, and
 * announces completion once the answer stops streaming (audit U-3: one status
 * on submit, one on stage change, one completion summary — never continuous
 * token-level announcements).
 *
 * #219 gave the wait its visual treatment, sanctioned by the amended DESIGN
 * §8 (the wait is the opening of motion moment 2): a seal-ring — eight dots
 * chasing the rim of a 20px sello, in `--sello` red, foreshadowing the stamp
 * settle the answer ends on — plus the label shine, and a 150ms crossfade
 * between stage labels. All of it is CSS (globals.css); under
 * `prefers-reduced-motion` the ring hides, the shine goes static, and the
 * crossfade drops to an instant swap, which is exactly the pre-#219 behavior.
 *
 * The accessibility contract is untouched: label text still changes once per
 * stage (the crossfade delays the mutation by 150ms, it does not split it),
 * and the ring is presentational, so the live region announces exactly what
 * it did before.
 */
import * as React from "react";

import type { AskStatusStage } from "@/lib/answer/contract";
import { cn, prefersReducedMotion } from "@/lib/utils";

const STAGE_LABEL: Record<AskStatusStage, string> = {
  buscando: "Consultando los documentos oficiales…",
  redactando: "Redactando la respuesta…",
  verificando: "Verificando citas…",
};

/** DESIGN §8: the label crossfade — 150ms, ease-out, ground rules apply. */
const CROSSFADE_MS = 150;

/**
 * Requirement 3's completion sentence. Spanish pluralization: zero and
 * plural counts both take "fuentes citadas"; only exactly one is singular.
 */
export function completionAnnouncement(citationCount: number): string {
  const noun = citationCount === 1 ? "fuente citada" : "fuentes citadas";
  return `Respuesta lista, ${citationCount} ${noun}.`;
}

/** What the status region has to show right now; absent once there is nothing. */
export type AskStatusState =
  { kind: "stage"; stage: AskStatusStage } | { kind: "complete"; text: string };

function sameState(
  a: AskStatusState | null,
  b: AskStatusState | null,
): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind !== b.kind) return false;
  return a.kind === "stage"
    ? a.stage === (b as { stage: AskStatusStage }).stage
    : a.text === (b as { text: string }).text;
}

/**
 * The eight-dot seal rim. Purely presentational — the label carries the
 * meaning — and hidden entirely under `prefers-reduced-motion` (CSS).
 */
function SealRing() {
  return (
    <span className="seal-ring" aria-hidden="true">
      {Array.from({ length: 8 }, (_, dot) => (
        <i key={dot} style={{ "--dot": dot } as React.CSSProperties} />
      ))}
    </span>
  );
}

/**
 * The status region itself. Deliberately mounts and unmounts with `state`
 * rather than staying in the DOM empty: a live region's content arriving in
 * the same insertion is the same pattern toast announcers rely on, and
 * nothing lingers as residual empty markup once a stage or the completion
 * summary has had its moment. `aria-live="polite"` is explicit alongside
 * `role="status"` (which already implies it) — belt-and-suspenders for the
 * mount-with-content case, which some screen readers pick up less reliably
 * than a mutation on an already-mounted region.
 *
 * A stage → stage change crossfades (#219): the shown label fades out over
 * 150ms, then the new one replaces it and fades back in. Appearing,
 * disappearing, and reduced motion all stay instant — the fade is only for
 * the swap, where two labels would otherwise jump-cut.
 *
 * `announce` defaults on; `chat.tsx` sets it `false` for the pre-start
 * fallback (the brief window before the real assistant message exists) so
 * that region never fires its own mount-with-content announcement — only the
 * real per-message region does, once, once the message exists. Without this,
 * the pre-start placeholder unmounting as the real message's identical
 * "Consultando…" region mounts would risk two announcements for one
 * submission (issue #72's acceptance: "one status on submit"). The
 * placeholder stays visible to sighted users either way — only its
 * accessibility-tree presence changes.
 */
export function AskStatus({
  state,
  announce = true,
}: {
  state: AskStatusState | null;
  announce?: boolean;
}) {
  const [shown, setShown] = React.useState(state);
  // Appearing, disappearing, and reduced motion land immediately — the
  // render-time derived-state adjustment, so no effect is involved. Only a
  // stage → stage swap is left trailing `state`, and that gap *is* the
  // crossfade: `swapping` is derived, and the timer below closes it.
  if (
    !sameState(state, shown) &&
    (state === null || shown === null || prefersReducedMotion())
  ) {
    setShown(state);
  }
  const swapping = !sameState(state, shown);

  // The swap timer keys on `swapping` alone and reads the target through a
  // ref: `state` is a fresh object literal every parent render, and having it
  // as a dependency would clear and restart the timeout on every unrelated
  // re-render mid-swap — under a fast delta stream the label would stay stuck
  // at opacity-0. With the ref, one timer per swap; if the stage changes
  // again inside the window, the swap lands on the latest stage (a stage that
  // lived under 150ms coalesces away rather than flashing).
  const stateRef = React.useRef(state);
  React.useEffect(() => {
    stateRef.current = state;
  });
  React.useEffect(() => {
    if (!swapping) return;
    const timer = setTimeout(() => setShown(stateRef.current), CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [swapping]);

  if (shown === null) return null;
  return (
    <p
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-hidden={announce ? undefined : "true"}
      className={cn(
        "flex items-center gap-2 text-sm text-muted-foreground",
        "transition-opacity duration-150 motion-reduce:transition-none",
        // The shimmer rides the <p> itself (not a wrapper span) so the label
        // stays this element's direct text node — the a11y tree and the
        // tests' text queries see exactly the pre-#219 structure.
        shown.kind === "stage" && "status-shimmer",
        swapping && "opacity-0",
      )}
    >
      {shown.kind === "stage" && <SealRing />}
      {shown.kind === "stage" ? STAGE_LABEL[shown.stage] : shown.text}
    </p>
  );
}
