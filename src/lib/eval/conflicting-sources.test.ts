import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildConflictJudgePrompt,
  CONFLICT_CHUNKS,
  CONFLICT_FIGURES,
  CONFLICT_JUDGE_SYSTEM_PROMPT,
  CONFLICT_QUESTION,
  writeConflictTranscript,
} from "./conflicting-sources";

describe("CONFLICT_CHUNKS", () => {
  it("contradict each other on exactly one figure", () => {
    expect(CONFLICT_CHUNKS).toHaveLength(2);
    const [a, b] = CONFLICT_CHUNKS;
    expect(a.content).toContain(CONFLICT_FIGURES[0]);
    expect(b.content).toContain(CONFLICT_FIGURES[1]);
    expect(a.content).not.toContain(CONFLICT_FIGURES[1]);
    expect(b.content).not.toContain(CONFLICT_FIGURES[0]);
    // Same claim, different number — otherwise this is two facts, not a
    // conflict, and the case would prove nothing.
    expect(a.content.replace(CONFLICT_FIGURES[0], "")).toBe(
      b.content.replace(CONFLICT_FIGURES[1], ""),
    );
  });

  it("are distinct documents, so citing both means two [n] markers", () => {
    const [a, b] = CONFLICT_CHUNKS;
    expect(a.docKey).not.toBe(b.docKey);
  });
});

describe("CONFLICT_JUDGE_SYSTEM_PROMPT", () => {
  it("demands the discrepancy be stated, not just two numbers listed", () => {
    expect(CONFLICT_JUDGE_SYSTEM_PROMPT).toMatch(/disagree|contradiction/i);
    expect(CONFLICT_JUDGE_SYSTEM_PROMPT).toMatch(/NOT enough/);
    expect(CONFLICT_JUDGE_SYSTEM_PROMPT).toMatch(/both figures/i);
    expect(CONFLICT_JUDGE_SYSTEM_PROMPT).toMatch(/\[n\] markers/);
    // A silent pick is the failure mode the whole case exists to catch.
    expect(CONFLICT_JUDGE_SYSTEM_PROMPT).toMatch(/picks one figure/i);
    expect(CONFLICT_JUDGE_SYSTEM_PROMPT).toMatch(/"verdict"/);
  });
});

describe("buildConflictJudgePrompt", () => {
  it("hands the judge the question, both numbered fragments, and the answer", () => {
    const prompt = buildConflictJudgePrompt(
      CONFLICT_QUESTION,
      CONFLICT_CHUNKS,
      "Las fuentes discrepan: ¢4.094.000 [1] y ¢3.947.000 [2].",
    );
    expect(prompt).toContain(CONFLICT_QUESTION);
    expect(prompt).toContain("[1]");
    expect(prompt).toContain("[2]");
    expect(prompt).toContain(CONFLICT_FIGURES[0]);
    expect(prompt).toContain(CONFLICT_FIGURES[1]);
    expect(prompt).toContain("Respuesta del asistente:");
    // The judge must know the fragments conflict by construction — it is not
    // being asked to discover that, only whether the answer says so.
    expect(prompt).toMatch(/se contradicen/i);
  });
});

describe("writeConflictTranscript", () => {
  const row = {
    answer: "Las fuentes discrepan: ¢4.094.000 [1] y ¢3.947.000 [2].",
    verdict: "pass" as const,
    verdicts: ["pass" as const],
    reason: "states both",
  };
  const now = new Date("2026-10-12T23:10:00Z");

  // #610: first-person-check.sh reads `id` and `answer` off each line.
  it("writes one line carrying the case id and the answer", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "conflict-"));
    const file = writeConflictTranscript(row, {
      dir,
      answerModel: "claude-sonnet-5-5-effort-low",
      now,
    });
    expect(path.basename(file)).toBe(
      "conflicting-sources-claude-sonnet-5-5-effort-low-20261012T231000Z.jsonl",
    );
    const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({
      id: "conflicting-sources",
      question: CONFLICT_QUESTION,
      ...row,
    });
  });

  it("never overwrites an earlier re-ask from the same second", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "conflict-"));
    const at = { dir, answerModel: "m", now };
    const first = writeConflictTranscript(row, at);
    const second = writeConflictTranscript({ ...row, answer: "otra" }, at);
    expect(second).not.toBe(first);
    expect(JSON.parse(readFileSync(first, "utf8")).answer).toBe(row.answer);
    expect(JSON.parse(readFileSync(second, "utf8")).answer).toBe("otra");
  });
});
