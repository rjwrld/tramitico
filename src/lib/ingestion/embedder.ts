/**
 * Pluggable embedder (SPEC §5). Provider chosen by EMBEDDINGS_PROVIDER:
 *   - "voyage"  → Voyage AI REST API (VOYAGE_API_KEY)
 *   - "openai"  → text-embedding-3-small (OPENAI_API_KEY)
 *   - "stub"    → deterministic hash vectors, keyless local dev only
 * The Voyage-vs-OpenAI decision is the Week 2 ADR; both stay swappable here.
 */

export interface Embedder {
  provider: string;
  dimensions: number;
  /**
   * Ingestion's embed: batched and paced, retries for as long as the provider
   * asks it to. Minutes are an acceptable cost here — the CLI is the only
   * caller and nobody is waiting on a response.
   */
  embed(texts: string[]): Promise<number[][]>;
  /**
   * The interactive path's embed (#127): one text, one attempt, and a hard
   * {@link INTERACTIVE_EMBED_TIMEOUT_MS} abort budget. It is deliberately a
   * separate method rather than an option on `embed`, because the two policies
   * are answerable to different clocks — `embed` may sleep 30 s and try again
   * 60 times, which on the ask path would blow `maxDuration = 60` long before
   * it produced a vector. A caller that cannot get one in the budget is
   * expected to degrade (lexical-only retrieval), not to wait.
   */
  embedQuery(text: string): Promise<number[]>;
}

/**
 * Abort budget for one interactive query embed (#127). ~5 s of a 60 s route
 * budget: generous for a healthy provider (a one-text embed is well under a
 * second), short enough that an outage costs the ask a pause rather than the
 * answer — the fallback still has the whole lexical leg and the model call to
 * run afterwards.
 */
export const INTERACTIVE_EMBED_TIMEOUT_MS = 5_000;

const STUB_DIM = 256;

// Single-text embeds repeat heavily — the seeded one-click prompts (SPEC §8)
// and test suites ask the same questions again and again — and every Voyage
// request is precious at 3/min. Memoize lone-query embeddings module-wide.
const QUERY_CACHE_MAX = 500;
const queryCache = new Map<string, number[]>();

function cacheKey(provider: string, text: string): string {
  return `${provider}::${text}`;
}

function cacheGet(provider: string, text: string): number[] | undefined {
  return queryCache.get(cacheKey(provider, text));
}

function cachePut(provider: string, text: string, vector: number[]): void {
  if (queryCache.size >= QUERY_CACHE_MAX) {
    const oldest = queryCache.keys().next().value;
    if (oldest !== undefined) queryCache.delete(oldest);
  }
  queryCache.set(cacheKey(provider, text), vector);
}

function stubVector(text: string): number[] {
  const v = new Array<number>(STUB_DIM).fill(0);
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    v[Math.abs(h) % STUB_DIM] += 1;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

export interface EmbedderOptions {
  fetchImpl?: typeof fetch;
  /**
   * Abort budget for `embedQuery`, defaulting to
   * {@link INTERACTIVE_EMBED_TIMEOUT_MS}. Overridable so tests can assert the
   * abort without spending five real seconds on it.
   */
  queryTimeoutMs?: number;
}

/** Thrown by {@link requestEmbeddings} on a non-OK response; carries the
 * status and Retry-After (seconds, 0 if absent) so callers that need to
 * retry (Voyage) can decide without re-parsing the response themselves. */
class EmbeddingRequestError extends Error {
  constructor(
    prefix: string,
    readonly status: number,
    readonly retryAfterSeconds: number,
  ) {
    super(`${prefix}: HTTP ${status}`);
    this.name = "EmbeddingRequestError";
  }
}

// Shared shape of a Voyage/OpenAI embeddings call: POST { model, input },
// Bearer auth, JSON body; on success parse `data[].embedding` in request
// order. Retry/pacing is provider-specific and lives outside this helper.
async function requestEmbeddings(
  fetchImpl: typeof fetch,
  url: string,
  key: string,
  model: string,
  texts: string[],
  errorPrefix: string,
  signal?: AbortSignal,
): Promise<number[][]> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model, input: texts }),
    signal,
  });
  if (!res.ok) {
    const retryAfterSeconds = Number(res.headers.get("retry-after")) || 0;
    throw new EmbeddingRequestError(errorPrefix, res.status, retryAfterSeconds);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data.map((d) => d.embedding);
}

/** What `interactiveQueryEmbedder` needs to reach one provider's endpoint. */
interface InteractiveQueryConfig {
  fetchImpl: typeof fetch;
  timeoutMs: number;
  provider: string;
  url: string;
  key: string;
  model: string;
  errorPrefix: string;
}

/**
 * Builds the `embedQuery` of a real provider: cache, then a single request
 * under an `AbortSignal.timeout`. No retry loop and no pacing gap by design —
 * every branch a provider outage could take here has to end within the budget,
 * and a second attempt is exactly what the ingestion policy does instead
 * (#127 req. 1). A timeout surfaces as the fetch's own abort rejection, which
 * `retrieve` reads as "degrade to lexical-only".
 */
function interactiveQueryEmbedder(
  cfg: InteractiveQueryConfig,
): (text: string) => Promise<number[]> {
  return async (text) => {
    const cached = cacheGet(cfg.provider, text);
    if (cached) return cached;
    const [vector] = await requestEmbeddings(
      cfg.fetchImpl,
      cfg.url,
      cfg.key,
      cfg.model,
      [text],
      cfg.errorPrefix,
      AbortSignal.timeout(cfg.timeoutMs),
    );
    cachePut(cfg.provider, text, vector);
    return vector;
  };
}

export function createEmbedder(
  // `||`, not `??`: CI interpolates an unset `vars.EMBEDDINGS_PROVIDER` as
  // "", which must mean the keyless stub default, not an unknown provider.
  provider = process.env.EMBEDDINGS_PROVIDER || "stub",
  options: EmbedderOptions = {},
): Embedder {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.queryTimeoutMs ?? INTERACTIVE_EMBED_TIMEOUT_MS;
  if (provider === "stub") {
    return {
      provider,
      dimensions: STUB_DIM,
      embed: async (texts) => texts.map(stubVector),
      embedQuery: async (text) => stubVector(text),
    };
  }
  if (provider === "voyage") {
    const key = process.env.VOYAGE_API_KEY;
    if (!key)
      throw new Error("EMBEDDINGS_PROVIDER=voyage needs VOYAGE_API_KEY");
    // Keyless-tier Voyage allows ~3 requests + 10K tokens per minute, so
    // embed() paces itself: small sub-batches, 429 treated as "wait", not
    // failure (ADR 0003). A full corpus re-embed takes ~20 minutes.
    const RETRY_MS = 30_000;
    const MAX_RETRIES = 60;
    // The 10K-TPM keyless tier rejects any single request above the budget
    // FOREVER, so batches are sized by estimated tokens, not text count
    // (~3.5 chars/token for this Spanish legal corpus, budget with headroom).
    const TOKEN_BUDGET = 8_000;
    const MAX_BATCH = 12;
    const estTokens = (text: string) => Math.ceil(text.length / 3.5);
    // Adaptive pacing: run at full speed until the API pushes back, then
    // hold ≥21s between requests (fits the keyless 3/min window; bursting
    // there provokes penalty stretches where every retry 429s). Accounts
    // with a payment method never trip this and stay fast.
    const MIN_GAP_MS = 21_000;
    let paced = false;
    let lastRequestAt = 0;
    const embedBatch = async (texts: string[]): Promise<number[][]> => {
      for (let attempt = 0; ; attempt++) {
        if (paced) {
          const gap = lastRequestAt + MIN_GAP_MS - Date.now();
          if (gap > 0) await new Promise((r) => setTimeout(r, gap));
        }
        lastRequestAt = Date.now();
        try {
          return await requestEmbeddings(
            fetchImpl,
            "https://api.voyageai.com/v1/embeddings",
            key,
            "voyage-3",
            texts,
            "Voyage embeddings",
          );
        } catch (err) {
          if (!(err instanceof EmbeddingRequestError)) throw err;
          const retryable = err.status === 429 || err.status >= 500;
          if (!retryable || attempt >= MAX_RETRIES) throw err;
          if (err.status === 429) paced = true;
          // Rejected requests count against the rate limit too — waiting
          // longer than Retry-After (min 30s) beats polling it away.
          await new Promise((r) =>
            setTimeout(r, Math.max(RETRY_MS, err.retryAfterSeconds * 1000)),
          );
        }
      }
    };
    return {
      provider,
      dimensions: 1024,
      embedQuery: interactiveQueryEmbedder({
        fetchImpl,
        timeoutMs,
        provider,
        url: "https://api.voyageai.com/v1/embeddings",
        key,
        model: "voyage-3",
        errorPrefix: "Voyage embeddings",
      }),
      embed: async (texts) => {
        if (texts.length === 1) {
          const cached = cacheGet(provider, texts[0]);
          if (cached) return [cached];
          const [vector] = await embedBatch(texts);
          cachePut(provider, texts[0], vector);
          return [vector];
        }
        const vectors: number[][] = [];
        let batch: string[] = [];
        let batchTokens = 0;
        for (const text of texts) {
          const tokens = estTokens(text);
          if (
            batch.length > 0 &&
            (batch.length >= MAX_BATCH || batchTokens + tokens > TOKEN_BUDGET)
          ) {
            vectors.push(...(await embedBatch(batch)));
            batch = [];
            batchTokens = 0;
          }
          batch.push(text);
          batchTokens += tokens;
        }
        if (batch.length > 0) vectors.push(...(await embedBatch(batch)));
        return vectors;
      },
    };
  }
  if (provider === "openai") {
    const key = process.env.OPENAI_API_KEY;
    if (!key)
      throw new Error("EMBEDDINGS_PROVIDER=openai needs OPENAI_API_KEY");
    return {
      provider,
      dimensions: 1536,
      embedQuery: interactiveQueryEmbedder({
        fetchImpl,
        timeoutMs,
        provider,
        url: "https://api.openai.com/v1/embeddings",
        key,
        model: "text-embedding-3-small",
        errorPrefix: "OpenAI embeddings",
      }),
      embed: (texts) =>
        requestEmbeddings(
          fetchImpl,
          "https://api.openai.com/v1/embeddings",
          key,
          "text-embedding-3-small",
          texts,
          "OpenAI embeddings",
        ),
    };
  }
  throw new Error(`Unknown EMBEDDINGS_PROVIDER: ${provider}`);
}

/**
 * Is a real (non-stub) embeddings provider configured and constructible?
 *
 * The prerequisite check for the eval suites (issue #129): a misconfigured
 * provider — `EMBEDDINGS_PROVIDER=voyage` with no key — is an *absent*
 * prerequisite, not a crash at module load, so the gate can report it.
 */
export function realEmbedderConfigured(): boolean {
  try {
    return createEmbedder().provider !== "stub";
  } catch {
    return false;
  }
}
