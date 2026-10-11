import { describe, expect, it } from "vitest";
import { normalizeEmail } from "../../src/auth/email-identity";
import { parseStartBody } from "../../src/auth/session/request-parsers";

describe("single email identity boundary", () => {
  it.each(["login", "signup"])("allows Gmail %s without merging aliases", (purpose) => {
    expect(parseStartBody({ identifier: " User.Name+tag@GMAIL.COM ", purpose }).identifier)
      .toBe("user.name+tag@gmail.com");
  });

  it.each([
    "user@example.com", "user@googlemail.com", "user@gmail.com.evil.example",
    "user@sub.gmail.com", "user@gmail.co", "user@gmaіl.com"
  ])("rejects non-Gmail auth identities: %s", (identifier) => {
    for (const purpose of ["login", "signup"]) {
      expect(() => parseStartBody({ identifier, purpose })).toThrow();
    }
  });

  it("preserves ordinary and plus-addressed identities", () => {
    expect(normalizeEmail(" User.Name+tag@Example.com ")).toBe("user.name+tag@example.com");
  });

  it.each([
    "one@example.com,two@example.com",
    "one@example.com;two@example.com",
    "Display Name <one@example.com>",
    "one@example.com\r\nBcc: two@example.com",
    "one@@example.com",
    "one two@example.com",
    ".one@example.com",
    "one..two@example.com",
    "one@example",
    `${"a".repeat(65)}@example.com`,
    `${"a".repeat(64)}@${"b".repeat(63)}.${"c".repeat(63)}.${"d".repeat(63)}.com`,
  ])("rejects malformed/multiple-recipient input: %s", (identifier) => {
    expect(() => normalizeEmail(identifier)).toThrow("valid email");
    expect(() => parseStartBody({ identifier, purpose: "login" })).toThrow("valid email");
  });
});
