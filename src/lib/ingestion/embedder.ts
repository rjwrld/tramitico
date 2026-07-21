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
  provider = process.env.EMBEDDINGS_PROVIDER ?? "stub",
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
    return {
      provider,
      dimensions: 1024,
      embed: async (texts) => {
        const res = await fetch("https://api.voyageai.com/v1/embeddings", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ model: "voyage-3", input: texts }),
        });
        if (!res.ok) throw new Error(`Voyage embeddings: HTTP ${res.status}`);
        const json = (await res.json()) as {
          data: { embedding: number[] }[];
        };
        return json.data.map((d) => d.embedding);
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
