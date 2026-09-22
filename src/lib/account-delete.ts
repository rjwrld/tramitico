// The minimum account age before self-service deletion (#384, #358 row 7).
//
// Delete + re-signup yields a fresh `auth.users.id` and a fresh authed quota,
// so with no cooldown the authed daily limit resets as fast as the hosted
// Auth email limit allows. A waiting period after sign-up prices that churn
// in hours instead of clicks, while an established account still deletes
// itself in one click — the #136 promise the privacy page makes.

const DEFAULT_MIN_AGE_MINUTES = 60;

/**
 * Minutes an account must exist before `/api/account/delete` will remove it:
 * `ACCOUNT_DELETE_MIN_AGE_MINUTES` when set to a positive number, else 60.
 * Zero is not a valid override — set it to a small number to all but disable
 * the wait; the fallback exists so an unset or garbled value never opens the
 * reset path by accident.
 */
export function accountDeleteMinAgeMinutes(): number {
  const raw = process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES;
  if (!raw) return DEFAULT_MIN_AGE_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MIN_AGE_MINUTES;
}

/**
 * Whether an account created at `createdAt` is still inside the waiting
 * period. An unparseable timestamp counts as too young: the check exists to
 * keep the reset path closed, so a value it cannot read must not open it.
 */
export function isAccountTooYoung(
  createdAt: string | null | undefined,
  minAgeMinutes: number,
  now = new Date(),
): boolean {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(created)) return true;
  return now.getTime() - created < minAgeMinutes * 60_000;
}

/** "una hora", "dos horas", "90 minutos" — the wait in reader-facing Spanish. */
export function describeWait(minutes: number): string {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    if (hours === 1) return "una hora";
    if (hours === 2) return "dos horas";
    return `${hours} horas`;
  }
  return `${minutes} minutos`;
}

/**
 * The one sentence about the waiting period, worded for the three places it
 * appears: the 409 body, the disabled menu entry (which shows the 409 body
 * verbatim), and `/privacidad`.
 */
export function accountDeleteWaitCopy(
  minutes = accountDeleteMinAgeMinutes(),
): string {
  return `Una cuenta se puede eliminar a partir de ${describeWait(minutes)} después de crearla; antes, la opción no está disponible.`;
}
