/**
 * Answer-latency probe (#356): where a Tier 1 answer's generation time goes,
 * per thinking configuration, with no judge and no eval harness.
 *
 * The production pass on 2026-09-22 found three of the nine seed prompts
 * waiting 20–32 s for their first text delta. `claude-sonnet-5` thinks
 * adaptively when a request omits `thinking` (effort `high`, display
 * `omitted`), and `generateAnswer` passes neither — so the suspicion is silent
 * reasoning. This probe confirms or refutes that: one retrieval + rerank per
 * seed prompt (the route's own path, against the local corpus), then the same
 * system prompt and user prompt sent once per arm, timing first reasoning,
 * first text and total, and recording reasoning vs text output tokens and
 * whether the draft passes the citation invariant (#131).
 *
 * Paid, but small: 9 prompts × 4 arms ≈ 36 answer generations on Sonnet 5,
 * roughly US$1–2, plus cents of embeddings and rerank. A diagnostic, not a
 * gate — a faster arm still needs an eval arm against the #352 gates.
 *
 *   pnpm answer-latency-probe [out.json] [--arms=default,medium,low,off]
 *     [--prompts=1,6] [--repeat=N] [--keep-text]
 *
 * `--keep-text` (#403) also writes each draft's text and, per prompt, the
 * numbered answer set and the resolved derived figures — enough to read which
 * `[n]` a failing draft put on a figure's clause.
 *
 * Writes to `eval/transcripts/` by default: gitignored and worktree-local, so
 * copy it to the main checkout before removing a worktree.
 *
 * Arms run interleaved per prompt, so provider load drift hits every arm alike.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
/** `.env.local`, the way `ingest.ts` loads it — never over an exported value. */
function loadDotEnvLocal(): void {
  const file = path.resolve(__dirname, "..", ".env.local");
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
import {
  createAnthropic,
  type AnthropicLanguageModelOptions,
} from "@ai-sdk/anthropic";
import type { JSONObject } from "@ai-sdk/provider";
import { streamText } from "ai";
import { SEED_PROMPTS } from "../src/components/chat/seed-prompts";
import {
  incompletelyCitedDerivedFigures,
  pinDerivedFigureInputs,
  resolveDerivedFigures,
} from "../src/lib/answer/derived";
import { validateCitations } from "../src/lib/answer/invariant";
import { DEFAULT_ANSWER_MODEL } from "../src/lib/answer/model";
import {
  ANSWER_SYSTEM_PROMPT,
  buildUserPrompt,
} from "../src/lib/answer/prompt";
import { RERANK_POOL, rerankChunks } from "../src/lib/answer/rerank";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import { retrieve } from "../src/lib/retrieval";

/** `ANSWER_MAX_OUTPUT_TOKENS` in route.ts — not imported, the route module drags in Next. */
const ANSWER_MAX_OUTPUT_TOKENS = 4096;

interface Arm {
  name: string;
  model: string;
  /** `providerOptions.anthropic` for the call; `undefined` is production. */
  anthropic?: AnthropicLanguageModelOptions & JSONObject;
}

const ARMS: Record<string, Arm> = {
  default: { name: "default", model: DEFAULT_ANSWER_MODEL },
  medium: {
    name: "medium",
    model: DEFAULT_ANSWER_MODEL,
    anthropic: { effort: "medium" },
  },
  low: {
    name: "low",
    model: DEFAULT_ANSWER_MODEL,
    anthropic: { effort: "low" },
  },
  off: {
    name: "off",
    model: DEFAULT_ANSWER_MODEL,
    anthropic: { thinking: { type: "disabled" } },
  },
  haiku: { name: "haiku", model: "claude-haiku-4-5" },
};

interface Row {
  prompt: number;
  arm: string;
  repeat: number;
  /** Seconds from request to the first reasoning / text part; null if none. */
  firstReasoning: number | null;
  firstText: number | null;
  total: number;
  outputTokens: number | null;
  reasoningTokens: number | null;
  textTokens: number | null;
  chars: number;
  /** The route's two checks, as the route would run them on this draft. */
  citationsOk: boolean;
  derivedOk: boolean;
  /** What `incompletelyCitedDerivedFigures` named, when `derivedOk` is false. */
  derivedMissing: string[];
  error: string | null;
  /** The draft itself, under `--keep-text` only. */
  text?: string;
}

/** What a draft's markers point at, under `--keep-text` only. */
interface PromptContext {
  prompt: number;
  chunks: { n: number; docKey: string; articulo: string | null }[];
  derivedFigures: {
    id: string;
    formattedValue: string;
    citationMarkers: number[];
  }[];
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main(): Promise<void> {
  loadDotEnvLocal();
  const out =
    process.argv.slice(2).find((a) => !a.startsWith("--")) ??
    `eval/transcripts/answer-latency-probe-${new Date().toISOString().slice(0, 10)}.json`;
  const arms = (arg("arms") ?? "default,medium,low,off").split(",").map((n) => {
    const arm = ARMS[n];
    if (!arm) throw new Error(`unknown arm: ${n}`);
    return arm;
  });
  const repeat = Number(arg("repeat") ?? "1");
  const anthropic = createAnthropic();
  const embedder = createEmbedder();
  const rows: Row[] = [];
  const keepText = process.argv.includes("--keep-text");
  const contexts: PromptContext[] = [];

  // 1-based seed-prompt numbers, e.g. `--prompts=6`; all nine when absent.
  const only = arg("prompts")?.split(",").map(Number);

  for (const [i, question] of SEED_PROMPTS.entries()) {
    if (only && !only.includes(i + 1)) continue;
    const retrieval = await retrieve(question, {
      matchCount: RERANK_POOL,
      embedder,
    });
    if (retrieval.isWeak) {
      console.log(
        `#${i + 1} weak retrieval — skipped (the route would decline)`,
      );
      continue;
    }
    const chunks = pinDerivedFigureInputs(
      await rerankChunks(question, retrieval.chunks, {
        expansion: retrieval.expansion,
        steps: retrieval.steps?.sentences ?? null,
      }),
      retrieval.chunks,
    );
    const derivedFigures = resolveDerivedFigures(chunks);
    const prompt = buildUserPrompt(question, chunks, { derivedFigures });
    if (keepText) {
      contexts.push({
        prompt: i + 1,
        chunks: chunks.map((chunk, n) => ({
          n: n + 1,
          docKey: chunk.docKey,
          articulo: chunk.articulo,
        })),
        derivedFigures: derivedFigures.map((figure) => ({
          id: figure.id,
          formattedValue: figure.formattedValue,
          citationMarkers: figure.citationMarkers,
        })),
      });
    }

    for (let r = 1; r <= repeat; r += 1) {
      for (const arm of arms) {
        const row: Row = {
          prompt: i + 1,
          arm: arm.name,
          repeat: r,
          firstReasoning: null,
          firstText: null,
          total: 0,
          outputTokens: null,
          reasoningTokens: null,
          textTokens: null,
          chars: 0,
          citationsOk: false,
          derivedOk: false,
          derivedMissing: [],
          error: null,
        };
        const t0 = performance.now();
        const since = () => +((performance.now() - t0) / 1000).toFixed(2);
        try {
          const result = streamText({
            model: anthropic(arm.model),
            system: ANSWER_SYSTEM_PROMPT,
            prompt,
            maxOutputTokens: ANSWER_MAX_OUTPUT_TOKENS,
            ...(arm.anthropic
              ? { providerOptions: { anthropic: arm.anthropic } }
              : {}),
          });
          let text = "";
          for await (const part of result.stream) {
            if (part.type === "reasoning-start") row.firstReasoning ??= since();
            else if (part.type === "text-delta" && part.text.length > 0) {
              row.firstText ??= since();
              text += part.text;
            } else if (part.type === "error") throw part.error;
          }
          row.total = since();
          const usage = await result.usage;
          row.outputTokens = usage.outputTokens ?? null;
          row.reasoningTokens =
            usage.outputTokenDetails.reasoningTokens ?? null;
          row.textTokens = usage.outputTokenDetails.textTokens ?? null;
          row.chars = text.length;
          if (keepText) row.text = text;
          row.citationsOk = validateCitations(text, chunks.length).ok;
          row.derivedMissing = incompletelyCitedDerivedFigures(
            text,
            derivedFigures,
          );
          row.derivedOk = row.derivedMissing.length === 0;
        } catch (error) {
          row.total = since();
          row.error = error instanceof Error ? error.message : String(error);
        }
        rows.push(row);
        console.log(
          `#${row.prompt} ${arm.name.padEnd(7)} first-text ${String(row.firstText ?? "—").padStart(6)}s  total ${String(row.total).padStart(6)}s  out ${row.outputTokens ?? "?"} (reasoning ${row.reasoningTokens ?? "?"})  ${row.citationsOk && row.derivedOk ? "valid" : "INVALID"}${row.error ? `  error: ${row.error}` : ""}`,
        );
      }
    }
  }

  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(
    out,
    JSON.stringify(
      {
        ranAt: new Date().toISOString(),
        ...(keepText ? { contexts } : {}),
        rows,
      },
      null,
      1,
    ),
  );
  console.log(`\nper arm (median over ${rows.length / arms.length} runs):`);
  const median = (xs: number[]) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN;
  };
  for (const arm of arms) {
    const mine = rows.filter((r) => r.arm === arm.name && !r.error);
    console.log(
      `${arm.name.padEnd(7)} first-text ${median(mine.map((r) => r.firstText ?? r.total))}s  total ${median(mine.map((r) => r.total))}s  max ${Math.max(...mine.map((r) => r.total))}s  reasoning ${median(mine.map((r) => r.reasoningTokens ?? 0))} tok  invalid ${mine.filter((r) => !(r.citationsOk && r.derivedOk)).length}/${mine.length}`,
    );
  }
  console.log(`wrote ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
