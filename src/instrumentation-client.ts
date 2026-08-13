import * as z from "zod";

/**
 * Zod compiles object validators with `new Function` unless told not to, and
 * the AI SDK's client-side stream parsing builds those validators at module
 * evaluation. Zod already degrades gracefully when a CSP blocks the compile —
 * but the probe still fires a `securitypolicyviolation`, which would keep the
 * #137 report-only stream permanently noisy and make `'unsafe-eval'` look
 * required for promotion. `jitless` skips the probe entirely.
 *
 * Next runs this file before the application's frontend code, which is early
 * enough: the validators are built when the SDK chunk evaluates, after this.
 */
z.config({ jitless: true });
