import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { crossReferencesEnabled } from "../src/lib/answer/cross-references";
import { expansionEnabled } from "../src/lib/answer/expand";
import { pinEnabled } from "../src/lib/answer/derived";
import {
  rerankEnabled,
  STEP_RERANK_MODES,
  stepRerankMode,
} from "../src/lib/answer/rerank";
import { stepsEnabled } from "../src/lib/answer/steps";
import { createEmbedder } from "../src/lib/ingestion/embedder";
import { limitFor } from "../src/lib/rate-limit";

/**
 * The wizard wrote `RERANK=on` into production on 2026-09-15, rerank.ts read
 * it as off, and production ran unreranked until #498. This suite is the test
 * that would have caught it (#499): every value the wizard writes as a
 * literal must be one the code reads as the mode the value names, without the
 * `console.error` knobs.ts logs for a value it does not know.
 */
const SCRIPT = path.join(__dirname, "deploy-wizard.sh");

/**
 * How the code reads each variable the wizard may write as a literal. `read`
 * is what the code makes of the variable as currently set; `meaning` is what
 * a value names, or `undefined` when it names nothing the variable accepts.
 */
interface Reading {
  read: () => unknown;
  meaning: (value: string) => unknown;
}

const onOff = (value: string) =>
  value === "on" ? true : value === "off" ? false : undefined;

const positiveInteger = (value: string) =>
  /^[1-9]\d*$/.test(value) ? Number(value) : undefined;

const READINGS: Record<string, Reading> = {
  RERANK: {
    read: rerankEnabled,
    meaning: (value) =>
      value === "voyage" ? true : value === "off" ? false : undefined,
  },
  EXPAND: { read: expansionEnabled, meaning: onOff },
  STEPS: { read: stepsEnabled, meaning: onOff },
  PIN_DERIVED_INPUTS: { read: pinEnabled, meaning: onOff },
  PIN_CROSS_REFERENCES: { read: crossReferencesEnabled, meaning: onOff },
  STEPS_RERANK: {
    read: stepRerankMode,
    meaning: (value) => STEP_RERANK_MODES.find((mode) => mode === value),
  },
  EMBEDDINGS_PROVIDER: {
    read: () => createEmbedder().provider,
    meaning: (value) =>
      value === "stub" || value === "voyage" ? value : undefined,
  },
  RATE_LIMIT_ANON: { read: () => limitFor("anon"), meaning: positiveInteger },
  RATE_LIMIT_AUTHED: {
    read: () => limitFor("authed"),
    meaning: positiveInteger,
  },
};

interface EnvWrite {
  key: string;
  /**
   * The literal value; `null` when it comes from a shell variable, and
   * `undefined` when the call is not `write_env KEY "value"` at all.
   */
  literal: string | null | undefined;
}

/** Every `write_env` call: the definition and comments are not calls. */
function envWrites(script: string): EnvWrite[] {
  return [...script.matchAll(/^\s*write_env\s+(.*)$/gm)].map(([, args]) => {
    const quoted = /^(\w+) "([^"]*)"\s*$/.exec(args);
    if (!quoted) return { key: args.split(/\s/)[0], literal: undefined };
    const [, key, value] = quoted;
    return { key, literal: /[$`\\]/.test(value) ? null : value };
  });
}

/** One line per write the code would read differently from what it names. */
function misreadWrites(script: string): string[] {
  const problems: string[] = [];
  for (const { key, literal } of envWrites(script)) {
    const reading = READINGS[key];
    if (literal === undefined) {
      problems.push(`${key}: write it as write_env KEY "value"`);
      continue;
    }
    if (literal === null) {
      if (reading)
        problems.push(`${key} is written from a variable; write a literal`);
      continue;
    }
    if (!reading) {
      problems.push(`${key}="${literal}": add how the code reads it`);
      continue;
    }
    const meant = reading.meaning(literal);
    if (meant === undefined) {
      problems.push(`${key}="${literal}" names no mode ${key} accepts`);
      continue;
    }
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    // Keyed for the parse alone: createEmbedder("voyage") throws without one,
    // and expansionEnabled() is off without one whatever EXPAND says.
    vi.stubEnv("VOYAGE_API_KEY", "placeholder");
    vi.stubEnv("ANTHROPIC_API_KEY", "placeholder");
    vi.stubEnv(key, literal);
    let read: unknown;
    try {
      read = reading.read();
    } catch (error) {
      read = error;
    }
    if (read !== meant)
      problems.push(`${key}="${literal}" reads as ${String(read)}`);
    if (errors.mock.calls.length > 0)
      problems.push(`${key}="${literal}" logs ${String(errors.mock.calls[0])}`);
    vi.unstubAllEnvs();
    errors.mockRestore();
  }
  return problems;
}

describe("deploy-wizard.sh writes only values the code reads as meant (#499)", () => {
  const script = readFileSync(SCRIPT, "utf8");

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("finds the writes it checks", () => {
    const keys = envWrites(script).map((write) => write.key);
    expect(keys).toContain("EMBEDDINGS_PROVIDER");
    expect(keys).toContain("RATE_LIMIT_ANON");
  });

  it("every literal write_env value parses to the mode it names", () => {
    expect(misreadWrites(script)).toEqual([]);
  });

  it("catches the line that kept production unreranked", () => {
    expect(misreadWrites('write_env RERANK "on"\n')).toEqual([
      'RERANK="on" names no mode RERANK accepts',
    ]);
  });

  it("catches a write it could not read, rather than skipping it", () => {
    expect(
      misreadWrites("write_env RERANK on\nwrite_env STEPS 'off'\n"),
    ).toEqual([
      'RERANK: write it as write_env KEY "value"',
      'STEPS: write it as write_env KEY "value"',
    ]);
  });

  it("lists for copying into Vercel only variables it wrote", () => {
    const listed = /for k in ([\s\S]*?); do/.exec(script)?.[1];
    expect(listed).toBeDefined();
    const written = new Set(envWrites(script).map((write) => write.key));
    const names = (listed ?? "").split(/[\s\\]+/).filter(Boolean);
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((name) => !written.has(name))).toEqual([]);
  });
});
