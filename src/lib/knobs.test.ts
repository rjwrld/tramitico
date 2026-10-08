import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KNOB_ERROR_PREFIX, modeKnob, positiveIntKnob } from "./knobs";

describe("modeKnob (#499)", () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const knob = () => modeKnob("TEST_KNOB", ["on", "off"], "on");

  it("reads unset and the empty string CI interpolates as the default, silently", () => {
    const read = knob();
    vi.stubEnv("TEST_KNOB", undefined);
    expect(read()).toBe("on");
    vi.stubEnv("TEST_KNOB", "");
    expect(read()).toBe("on");
    expect(errors).not.toHaveBeenCalled();
  });

  it("reads each accepted mode as itself, silently", () => {
    const read = knob();
    for (const mode of ["on", "off"]) {
      vi.stubEnv("TEST_KNOB", mode);
      expect(read()).toBe(mode);
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("reads an unknown value as the default and logs it once per cold start", () => {
    const read = knob();
    vi.stubEnv("TEST_KNOB", "OFF");
    expect(read()).toBe("on");
    expect(read()).toBe("on");
    expect(read()).toBe("on");
    expect(errors).toHaveBeenCalledOnce();
    const line = String(errors.mock.calls[0][0]);
    expect(line.startsWith(`${KNOB_ERROR_PREFIX} TEST_KNOB="OFF"`)).toBe(true);
    expect(line).toContain("accepted: on | off");
    expect(line).toContain("reading it as on");
  });

  it("logs a second, different bad value — the one the reader now holds", () => {
    const read = knob();
    vi.stubEnv("TEST_KNOB", "yes");
    read();
    vi.stubEnv("TEST_KNOB", "no");
    read();
    expect(errors).toHaveBeenCalledTimes(2);
  });

  it("never logs a value that could be a key pasted into the wrong variable", () => {
    const read = knob();
    const pasted = "placeholder-far-too-long-for-a-mode";
    vi.stubEnv("TEST_KNOB", pasted);
    expect(read()).toBe("on");
    const line = String(errors.mock.calls[0][0]);
    expect(line).not.toContain(pasted.slice(0, 8));
    expect(line).toContain(`(${pasted.length} chars, not shown)`);
  });
});

describe("positiveIntKnob (#519)", () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const knob = () => positiveIntKnob("TEST_KNOB", 8);
  const capKnob = () =>
    positiveIntKnob("TEST_KNOB", Infinity, { off: Infinity });

  it("reads unset and the empty string CI interpolates as the default, silently", () => {
    const read = knob();
    vi.stubEnv("TEST_KNOB", undefined);
    expect(read()).toBe(8);
    vi.stubEnv("TEST_KNOB", "");
    expect(read()).toBe(8);
    expect(errors).not.toHaveBeenCalled();
  });

  it("reads a positive integer as itself, silently", () => {
    const read = knob();
    for (const [value, n] of [
      ["1", 1],
      ["10", 10],
      ["12", 12],
    ] as const) {
      vi.stubEnv("TEST_KNOB", value);
      expect(read()).toBe(n);
    }
    expect(errors).not.toHaveBeenCalled();
  });

  it("reads one of its words as the number it names, silently", () => {
    const read = capKnob();
    vi.stubEnv("TEST_KNOB", "off");
    expect(read()).toBe(Infinity);
    vi.stubEnv("TEST_KNOB", "3");
    expect(read()).toBe(3);
    expect(errors).not.toHaveBeenCalled();
  });

  it("reads zero, a negative, a fraction and a word as the default, and logs each", () => {
    const read = knob();
    for (const value of ["0", "-3", "8.5", "ocho", "off"]) {
      vi.stubEnv("TEST_KNOB", value);
      expect(read()).toBe(8);
    }
    expect(errors).toHaveBeenCalledTimes(5);
    const line = String(errors.mock.calls[0][0]);
    expect(line.startsWith(`${KNOB_ERROR_PREFIX} TEST_KNOB="0"`)).toBe(true);
    expect(line).toContain("accepted: a positive integer, or unset");
    expect(line).toContain("reading it as 8");
  });

  it("logs a bad value once per cold start", () => {
    const read = knob();
    vi.stubEnv("TEST_KNOB", "diez");
    expect(read()).toBe(8);
    expect(read()).toBe(8);
    expect(read()).toBe(8);
    expect(errors).toHaveBeenCalledOnce();
  });

  it("names its words among the accepted values, and the default by its word", () => {
    const read = capKnob();
    vi.stubEnv("TEST_KNOB", "Off");
    expect(read()).toBe(Infinity);
    const line = String(errors.mock.calls[0][0]);
    expect(line).toContain("accepted: a positive integer | off, or unset");
    expect(line).toContain("reading it as off");
  });

  it("never logs a value that could be a key pasted into the wrong variable", () => {
    const read = knob();
    const pasted = "placeholder-far-too-long-for-a-number";
    vi.stubEnv("TEST_KNOB", pasted);
    expect(read()).toBe(8);
    const line = String(errors.mock.calls[0][0]);
    expect(line).not.toContain(pasted.slice(0, 8));
    expect(line).toContain(`(${pasted.length} chars, not shown)`);
  });
});
