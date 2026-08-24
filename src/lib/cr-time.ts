/**
 * The Costa Rica calendar, as one fact both the server and the browser use.
 *
 * Two surfaces need it and neither can import the other's module: the daily
 * quota window (#125, `rate-limit.ts`, server-only — it opens with
 * `node:crypto`) and the sello's "consultado el …" caption (#135,
 * `sello.tsx`, a client component). This file is value-free of both, so it
 * ships to either side.
 *
 * Costa Rica is UTC-6 year-round — no DST since 1992 — so the whole CR
 * calendar is a fixed shift and nothing here needs a timezone database. That
 * decision is #121's; `CR_TIME_ZONE` stays for `Intl` formatting, which does
 * want the real zone name.
 */
export const CR_TIME_ZONE = "America/Costa_Rica";

export const CR_UTC_OFFSET_MS = 6 * 60 * 60 * 1000;
