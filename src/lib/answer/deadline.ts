/**
 * The ask pipeline's internal deadline (#205).
 *
 * The platform kills the route at `maxDuration = 60` seconds, and a kill is
 * silent: no `finally` runs, no refund lands, no telemetry line is written —
 * the ask just vanishes, spent. So the pipeline carries its own cumulative
 * budget, ten seconds shy of the kill, and expiring it is an *observable*
 * system failure: the abort surfaces inside the route while it is still
 * alive, where the refund and the event provably get to run.
 *
 * Cumulative, not per-attempt: the timer starts before condensation and is
 * never reset, so retrieval, rerank and both generation attempts spend the
 * one budget `maxDuration` actually grants — a second attempt does not get a
 * fresh 50 seconds the platform will not honor. The signal *cancels* only
 * the generation call (the paid, long-running phase); the earlier phases
 * carry their own tighter budgets (condense.ts, the embed timeout) and are
 * checked against this deadline at each boundary in route.ts instead.
 *
 * A plain AbortController + setTimeout rather than `AbortSignal.timeout`:
 * the caller must be able to clear the timer once the pipeline settles (a
 * pending timeout would hold the function open), and fake-timer tests can
 * only advance what `setTimeout` schedules.
 */

export const ASK_DEADLINE_MS = 50_000;

export interface AskDeadline {
  /** Aborts when the budget expires. Compose with the client's own signal. */
  signal: AbortSignal;
  /** Stops the timer. Call once the pipeline has settled, expired or not. */
  clear: () => void;
}

export function startAskDeadline(ms: number = ASK_DEADLINE_MS): AskDeadline {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("ask: internal deadline exceeded"));
  }, ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}
