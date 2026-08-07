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
  embed(texts: string[]): Promise<number[][]>;
}

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

export function createEmbedder(
  // `||`, not `??`: CI interpolates an unset `vars.EMBEDDINGS_PROVIDER` as
  // "", which must mean the keyless stub default, not an unknown provider.
  provider = process.env.EMBEDDINGS_PROVIDER || "stub",
): Embedder {
  if (provider === "stub") {
    return {
      provider,
      dimensions: STUB_DIM,
      embed: async (texts) => texts.map(stubVector),
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
        const res = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "voyage-3", input: texts }),
        });
        if (res.ok) {
          const json = (await res.json()) as {
            data: { embedding: number[] }[];
          };
          return json.data.map((d) => d.embedding);
        }
        const retryable = res.status === 429 || res.status >= 500;
        if (!retryable || attempt >= MAX_RETRIES) {
          throw new Error(`Voyage embeddings: HTTP ${res.status}`);
        }
        if (res.status === 429) paced = true;
        // Rejected requests count against the rate limit too — waiting
        // longer than Retry-After (min 30s) beats polling it away.
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        await new Promise((r) =>
          setTimeout(r, Math.max(RETRY_MS, retryAfter * 1000)),
        );
      }
    };
    return {
      provider,
      dimensions: 1024,
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
      embed: async (texts) => {
        const res = await fetch("https://api.openai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "text-embedding-3-small",
            input: texts,
          }),
        });
        if (!res.ok) throw new Error(`OpenAI embeddings: HTTP ${res.status}`);
        const json = (await res.json()) as {
          data: { embedding: number[] }[];
        };
        return json.data.map((d) => d.embedding);
      },
    };
  }
  throw new Error(`Unknown EMBEDDINGS_PROVIDER: ${provider}`);
}
