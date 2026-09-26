import { describe, expect, it } from "vitest";

import { containsBlockedTerm } from "./display-name-guard";

describe("display name blocklist guard", () => {
  it("blocks an exact hit", () => {
    expect(containsBlockedTerm("לאונן")).toBe(true);
    expect(containsBlockedTerm("fuck")).toBe(true);
  });

  it("blocks a spacing trick that pads separators between every letter", () => {
    expect(containsBlockedTerm("ל א ו נ ן")).toBe(true);
    expect(containsBlockedTerm("ל.א.ו.נ.ן")).toBe(true);
    expect(containsBlockedTerm("f.u.c.k")).toBe(true);
  });

  it("blocks a niqqud-decorated hit", () => {
    expect(containsBlockedTerm("לְאוֹנֵן")).toBe(true);
  });

  it("does not block the platform name or innocent words containing the חזה root", () => {
    expect(containsBlockedTerm("החוזה")).toBe(false);
    expect(containsBlockedTerm("מחזה")).toBe(false);
    expect(containsBlockedTerm("חזהו")).toBe(false);
    expect(containsBlockedTerm("תחזית")).toBe(false);
  });

  it("blocks חזה only when it stands alone as its own word", () => {
    expect(containsBlockedTerm("חזה")).toBe(true);
    expect(containsBlockedTerm("איזה חזה")).toBe(true);
  });

  it("passes clean names", () => {
    expect(containsBlockedTerm("עומרי")).toBe(false);
    expect(containsBlockedTerm("Danny B")).toBe(false);
    expect(containsBlockedTerm("חזאי ABCD1234")).toBe(false);
  });

  it("catches latin leet substitution hits", () => {
    expect(containsBlockedTerm("n4z1")).toBe(true);
    expect(containsBlockedTerm("h1tl3r")).toBe(true);
    expect(containsBlockedTerm("$hit")).toBe(true);
  });
});
