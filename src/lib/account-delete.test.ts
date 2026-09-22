import { afterEach, describe, expect, it } from "vitest";

import {
  accountDeleteMinAgeMinutes,
  accountDeleteWaitCopy,
  describeWait,
  isAccountTooYoung,
} from "./account-delete";

const ORIGINAL = process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES;
  else process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES = ORIGINAL;
});

describe("accountDeleteMinAgeMinutes", () => {
  it("defaults to 60 when unset", () => {
    delete process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES;
    expect(accountDeleteMinAgeMinutes()).toBe(60);
  });

  it("reads a positive override", () => {
    process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES = "1440";
    expect(accountDeleteMinAgeMinutes()).toBe(1440);
  });

  it.each(["0", "-5", "abc", ""])(
    "falls back to 60 on the unusable value %j — a bad value never opens the reset path",
    (value) => {
      process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES = value;
      expect(accountDeleteMinAgeMinutes()).toBe(60);
    },
  );
});

describe("isAccountTooYoung", () => {
  const now = new Date("2026-09-21T12:00:00Z");

  it("is too young inside the window and old enough at the boundary", () => {
    expect(isAccountTooYoung("2026-09-21T11:30:00Z", 60, now)).toBe(true);
    expect(isAccountTooYoung("2026-09-21T11:00:00Z", 60, now)).toBe(false);
    expect(isAccountTooYoung("2026-09-20T12:00:00Z", 60, now)).toBe(false);
  });

  it("treats a missing or unparseable timestamp as too young", () => {
    expect(isAccountTooYoung(undefined, 60, now)).toBe(true);
    expect(isAccountTooYoung(null, 60, now)).toBe(true);
    expect(isAccountTooYoung("not a date", 60, now)).toBe(true);
  });
});

describe("describeWait / accountDeleteWaitCopy", () => {
  it("words whole hours and odd minutes in Spanish", () => {
    expect(describeWait(60)).toBe("una hora");
    expect(describeWait(120)).toBe("dos horas");
    expect(describeWait(180)).toBe("3 horas");
    expect(describeWait(90)).toBe("90 minutos");
  });

  it("builds the sentence from the enforced number", () => {
    process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES = "120";
    expect(accountDeleteWaitCopy()).toMatch(/a partir de dos horas después/);
    delete process.env.ACCOUNT_DELETE_MIN_AGE_MINUTES;
    expect(accountDeleteWaitCopy()).toMatch(/a partir de una hora después/);
  });
});
