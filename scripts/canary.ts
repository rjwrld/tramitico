/**
 * The daily production canary (#551): a few fixed questions through the real
 * `/api/ask`, judged on what the stream carries.
 *
 * Why it exists: production fails in ways no alert sees. The ask route is
 * stream-first (#71), so a dead provider, a spent `tramitico-prod` cap, a
 * revoked key or a paused database come back as a 200 with an `error` part in
 * it (runbook §1.3), and Hobby has no log drain to count them (§3.2).
 * Production ran unreranked for three weeks (#498) because nothing asked it a
 * question and looked at the answer. This does, once a day, from
 * `.github/workflows/canary.yml`, and fails the job — which files an issue —
 * when an answer is not one we would stand behind:
 *
 * - an error part (`retrieval_failed`, `answer_failed`, …) or a non-200;
 * - a decline — routed (`data-routed`) or fail-closed (no citations);
 * - a `data-degraded` answer, which is Voyage's embeddings down (#127);
 * - a citation marker the stream's `data-markers` / `data-citations` cannot
 *   resolve, an unclosed `[n`, or an answer citing nothing;
 * - an answer whose `data-reranked` part is `false` or missing: the rerank
 *   did not run, so the answer set is the fused order (#498);
 * - for the question that asks for one, no percentage in the answer.
 *
 * Self-contained on purpose: Node 24 runs this file as it is (type
 * stripping), so the workflow needs no `pnpm install` and runs no
 * dependency's code in a job that can write issues. The price is a second
 * copy of the marker syntax and the part names, and `canary.test.ts` pins
 * both to the modules that own them (`answer/citations.ts`, `contract.ts`).
 *
 * The questions are fixed and about no one, so `/privacidad` stays true: each
 * one passes through the subprocessors any anonymous ask does, and no new
 * one. Each spends one of the runner IP's anonymous asks, and the three
 * together about US$1.50 a month of `tramitico-prod`'s cap (runbook §3.3).
 *
 * The log is public (the repo is). It prints question ids, counts and the
 * failure list — and the first characters of the answer, which is text about
 * official documents, never about a person.
 */

export interface CanaryQuestion {
  /** A stable handle for the log and the issue; never the question itself. */
  id: string;
  question: string;
  /** Require a percentage in the answer: the question asks for a figure. */
  percentage: boolean;
}

/**
 * Not held-out cases (`held-out.test.ts` would fail a quote of one), and two
 * of them are pills a reader clicks first (`seed-prompts.tsx`), so the canary
 * walks the same path a first visit does. One Tier 1 figure (the IVA rate),
 * one CCSS question, one Hacienda question.
 */
export const CANARY_QUESTIONS: readonly CanaryQuestion[] = [
  {
    id: "iva-tarifa-general",
    question:
      "¿Cuál es la tarifa general del IVA que debo cobrar por mis servicios de desarrollo?",
    percentage: true,
  },
  {
    id: "ccss-cuota-independiente",
    question:
      "¿Cuánto pago a la CCSS como trabajador independiente y cómo se calcula la base?",
    percentage: false,
  },
  {
    id: "hacienda-inscripcion-exterior",
    question:
      "¿Tengo que inscribirme en Hacienda si facturo a clientes en el extranjero?",
    percentage: false,
  },
];

export const DEFAULT_HOST = "https://tramitico.com";

/**
 * Past the route's own `maxDuration` (60 s): a slower answer than that is a
 * platform kill, and the canary should report it as one rather than wait.
 */
export const ASK_TIMEOUT_MS = 75_000;

/** The wire's part names (contract.ts), pinned by `canary.test.ts`. */
export const PART = {
  citations: "data-citations",
  markers: "data-markers",
  degraded: "data-degraded",
  routed: "data-routed",
  reranked: "data-reranked",
} as const;

/** `citationMarkers`' syntax (answer/citations.ts). */
const MARKER = /\[(\d+)\]/g;
/** `unclosedMarkers`' syntax (answer/citations.ts, #352/#427). */
const UNCLOSED_MARKER = /\[(\d+)(?=\s|[:;—–-]|[.,](?!\d)|$)/g;
/** A figure as the answer prints a rate: «13 %», «13%», «10,5 %». */
const PERCENTAGE = /\d+(?:[.,]\d+)?\s?%/;

/** The `[n]` markers in `text`, in order — `citationMarkers`' reading. */
export function markersIn(text: string): number[] {
  return [...text.matchAll(MARKER)].map((match) => Number(match[1]));
}

/** The unclosed `[n` in `text`, in order — `unclosedMarkers`' reading. */
export function unclosedIn(text: string): number[] {
  return [...text.matchAll(UNCLOSED_MARKER)].map((match) => Number(match[1]));
}

export interface StreamPart {
  type: string;
  [key: string]: unknown;
}

/**
 * The AI SDK UI message stream, as SSE: one `data: <json>` line per part and
 * a closing `data: [DONE]`. A line that is not JSON is kept as an
 * `unparseable` part rather than thrown on, so it reaches the verdict.
 */
export function parseStream(body: string): StreamPart[] {
  const parts: StreamPart[] = [];
  for (const line of body.split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const payload = line.slice("data: ".length).trim();
    if (payload === "[DONE]") continue;
    try {
      const part: unknown = JSON.parse(payload);
      parts.push(
        typeof part === "object" && part !== null && "type" in part
          ? (part as StreamPart)
          : { type: "unparseable" },
      );
    } catch {
      parts.push({ type: "unparseable" });
    }
  }
  return parts;
}

/** The latest snapshot of a data part, under the contract's snapshot rule. */
function latest(parts: readonly StreamPart[], type: string): unknown {
  let data: unknown = undefined;
  for (const part of parts) if (part.type === type) data = part.data;
  return data;
}

/** `isCitation`'s required fields (citations.ts) — enough to render a seal. */
function isSeal(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.docKey === "string" && typeof v.docTitle === "string";
}

/** The machine code of an error envelope (contract.ts), or a placeholder. */
function errorCode(text: unknown): string {
  if (typeof text !== "string") return "no-error-text";
  try {
    const body: unknown = JSON.parse(text);
    const code = (body as { error?: unknown } | null)?.error;
    return typeof code === "string" ? code : "no-code";
  } catch {
    return "not-an-envelope";
  }
}

export interface AskVerdict {
  id: string;
  failures: string[];
  /** Counts for the log line; null where the ask never got that far. */
  citations: number | null;
  markers: number | null;
  /** `data-reranked`, or null when the stream did not carry it. */
  reranked: boolean | null;
  /** The answer's opening, for the log. */
  excerpt: string;
}

/** Judges one ask's stream. Pure: parts in, verdict out. */
export function assessStream(
  question: CanaryQuestion,
  parts: readonly StreamPart[],
): AskVerdict {
  const failures: string[] = [];

  for (const part of parts) {
    if (part.type === "error") {
      failures.push(`error part: ${errorCode(part.errorText)}`);
    }
    if (part.type === "unparseable") failures.push("unparseable stream line");
  }
  if (!parts.some((part) => part.type === "finish")) {
    failures.push("no finish part: the stream was cut short");
  }
  if (latest(parts, PART.degraded) === true) {
    failures.push("degraded: retrieval ran without its vector leg (#127)");
  }
  const routed = latest(parts, PART.routed) as
    { category?: unknown } | undefined;
  if (routed !== undefined) {
    failures.push(`declined: routed to ${String(routed?.category)}`);
  }

  const text = parts
    .filter((part) => part.type === "text-delta")
    .map((part) => (typeof part.delta === "string" ? part.delta : ""))
    .join("");
  if (text.trim() === "") failures.push("no answer text");

  const snapshot = latest(parts, PART.citations);
  const citations: unknown[] | null = Array.isArray(snapshot) ? snapshot : null;
  const markers = latest(parts, PART.markers);
  const sealCount = citations?.length ?? null;
  if (citations === null || sealCount === null || sealCount === 0) {
    // The fail-closed decline carries no citations and no routed part.
    if (text.trim() !== "" && routed === undefined) {
      failures.push(
        "no citations: an uncited answer or the fail-closed decline",
      );
    }
  } else {
    citations.forEach((seal, i) => {
      if (!isSeal(seal)) failures.push(`citation ${i + 1} is not a seal`);
    });
    const ordinals = Array.isArray(markers) ? markers : [];
    const cited = markersIn(text);
    if (cited.length === 0) failures.push("no citation markers in the answer");
    for (const n of new Set(cited)) {
      const ordinal: unknown = ordinals[n - 1];
      if (typeof ordinal !== "number" || ordinal < 1 || ordinal > sealCount) {
        failures.push(`marker [${n}] resolves to no seal`);
      }
    }
    for (const n of unclosedIn(text)) failures.push(`unclosed marker [${n}`);
  }

  // Every ask that reached the rerank carries the part (route.ts), the
  // fail-closed decline included; only the routed decline and an ask that
  // errored before it do not, and both have failed above already.
  const reranked = latest(parts, PART.reranked);
  if (reranked === false) failures.push("the rerank did not run (#498)");
  const errored = parts.some((part) => part.type === "error");
  if (reranked === undefined && routed === undefined && !errored) {
    failures.push("no data-reranked part: the rerank never reported");
  }

  if (question.percentage && text.trim() !== "" && !PERCENTAGE.test(text)) {
    failures.push("no percentage in an answer that asks for a rate");
  }

  return {
    id: question.id,
    failures,
    citations: sealCount,
    markers: Array.isArray(markers) ? markers.length : null,
    reranked: typeof reranked === "boolean" ? reranked : null,
    excerpt: text.replace(/\s+/g, " ").trim().slice(0, 160),
  };
}

/**
 * Why a fetch threw, as tokens: the error's name and, for undici's
 * `fetch failed`, its cause's code (`ENOTFOUND`, `ECONNREFUSED`, …) — what
 * tells a dead host from a timeout (`TimeoutError`).
 */
function fetchFailure(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  const code = (error.cause as { code?: unknown } | undefined)?.code;
  return typeof code === "string" ? `${error.name} ${code}` : error.name;
}

/** One ask over HTTP, judged. Never throws: a failure is a verdict. */
export async function askOnce(
  host: string,
  question: CanaryQuestion,
  fetchImpl: typeof fetch = fetch,
): Promise<AskVerdict> {
  const empty = {
    id: question.id,
    citations: null,
    markers: null,
    reranked: null,
    excerpt: "",
  };
  let response: Response;
  try {
    response = await fetchImpl(new URL("/api/ask", host), {
      method: "POST",
      // JSON and no Origin: what `isCrossSiteAsk` (admission.ts) admits from
      // a non-browser client, charged to this runner's own anonymous quota.
      headers: {
        "content-type": "application/json",
        "user-agent": "tramitico-canary (+https://github.com/rjwrld/tramitico)",
      },
      body: JSON.stringify({ question: question.question }),
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
  } catch (error) {
    return { ...empty, failures: [`request failed: ${fetchFailure(error)}`] };
  }
  const body = await response.text().catch(() => "");
  if (response.status !== 200) {
    return {
      ...empty,
      failures: [`HTTP ${response.status}: ${errorCode(body)}`],
    };
  }
  const type = response.headers.get("content-type") ?? "";
  if (!type.startsWith("text/event-stream")) {
    return { ...empty, failures: [`not a stream: content-type ${type}`] };
  }
  return assessStream(question, parseStream(body));
}

/** The log line for one verdict. */
export function formatVerdict(verdict: AskVerdict): string {
  const counts = `citations=${verdict.citations ?? "-"} markers=${verdict.markers ?? "-"} reranked=${verdict.reranked ?? "-"}`;
  if (verdict.failures.length === 0) return `ok    ${verdict.id} — ${counts}`;
  return [
    `FAIL  ${verdict.id} — ${counts}`,
    ...verdict.failures.map((failure) => `      - ${failure}`),
    ...(verdict.excerpt === "" ? [] : [`      answer: «${verdict.excerpt}»`]),
  ].join("\n");
}

/**
 * The host to ask: `CANARY_HOST`, else production. An origin only — a path or
 * a non-http(s) scheme is a typo in a dispatch, and refused before any ask.
 */
export function canaryHost(value: string | undefined): string {
  const raw = value?.trim() || DEFAULT_HOST;
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`CANARY_HOST must be http(s), got ${url.protocol}`);
  }
  return url.origin;
}

async function main(): Promise<void> {
  const host = canaryHost(process.env.CANARY_HOST);
  console.log(`canary: asking ${host}`);
  const verdicts: AskVerdict[] = [];
  // One at a time: three concurrent asks would measure our own contention.
  for (const question of CANARY_QUESTIONS) {
    const verdict = await askOnce(host, question);
    verdicts.push(verdict);
    console.log(formatVerdict(verdict));
  }
  const failed = verdicts.filter((verdict) => verdict.failures.length > 0);
  // The workflow's failure step puts this in the issue it files.
  const report = process.env.CANARY_REPORT;
  if (report) {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      report,
      [
        `Host: ${host}`,
        "",
        "```",
        ...verdicts.map(formatVerdict),
        "```",
        "",
      ].join("\n"),
    );
  }
  if (failed.length > 0) {
    console.error(`canary: ${failed.length} of ${verdicts.length} asks failed`);
    process.exit(1);
  }
  console.log(`canary: all ${verdicts.length} asks answered`);
}

if (process.argv[1]?.endsWith("canary.ts")) {
  main().catch((error: unknown) => {
    console.error(
      `canary: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exit(1);
  });
}
