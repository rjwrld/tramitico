/**
 * Staged progress for /api/ask (issue #72). #71 made the route stream-first
 * (ADR 0009): the first byte now arrives in milliseconds, so the old
 * `status === "submitted"` line in `chat.tsx` vanished before retrieval even
 * started, leaving the retrieval→generation gap blank. This renders the
 * server's own `data-status` snapshots instead — `statusFrom(message)` from
 * the #71 contract — in an accessible `role="status"` region, and announces
 * completion once the answer stops streaming (audit U-3: one status on
 * submit, one on stage change, one completion summary — never continuous
 * token-level announcements).
 *
 * AI Elements' loader/status primitives were the sanctioned starting point
 * (SPEC §8), but ship shimmer the DESIGN §8 motion budget forbids (no
 * skeleton shimmer, no new animated moment — DESIGN §8 names exactly three
 * sanctioned moments, none of which is this indicator; the 150ms crossfade
 * figure there belongs to the theme toggle, not a general allowance).
 * Rebuilt here from the existing `Spinner` + a text label instead of pulling
 * the registry component, so there is nothing to strip. A mount/unmount text
 * swap is instant rather than animated, which stays inside that budget
 * without spending any of it, and needs nothing extra for
 * `prefers-reduced-motion` since there is no motion to disable.
 */
import { Spinner } from "@/components/ui/spinner";
import type { AskStatusStage } from "@/lib/answer/contract";

const STAGE_LABEL: Record<AskStatusStage, string> = {
  buscando: "Consultando los documentos oficiales…",
  redactando: "Redactando la respuesta…",
};

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
  if (state === null) return null;
  return (
    <p
      role={announce ? "status" : undefined}
      aria-live={announce ? "polite" : undefined}
      aria-hidden={announce ? undefined : "true"}
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      {state.kind === "stage" && (
        <Spinner
          aria-hidden="true"
          aria-label={undefined}
          role="presentation"
        />
      )}
      {state.kind === "stage" ? STAGE_LABEL[state.stage] : state.text}
    </p>
  );
}
