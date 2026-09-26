import { describe, expect, it } from "vitest";

import { AuthSessionError } from "./errors";
import { parseStartBody, parseVerifyBody } from "./request-parsers";

function expectAuthError(fn: () => unknown, message: string): void {
  expect(fn).toThrow(AuthSessionError);

  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AuthSessionError);
    expect((error as AuthSessionError).statusCode).toBe(400);
    expect((error as AuthSessionError).code).toBe("invalid_request");
    expect((error as AuthSessionError).message).toBe(message);
  }
}

describe("auth session request parsers", () => {
  it("parses and normalizes auth start bodies", () => {
    expect(parseStartBody({
      identifier: " USER@Example.COM ",
      purpose: "login"
    })).toEqual({
      identifier: "user@example.com",
      purpose: "login"
    });
  });

  it("preserves auth start validation errors", () => {
    expectAuthError(
      () => parseStartBody(null),
      "Auth start body must be a JSON object."
    );
    expectAuthError(
      () => parseStartBody({ identifier: "user@example.com" }),
      "purpose is required."
    );
    expectAuthError(
      () => parseStartBody({ identifier: "user@example.com", purpose: "reset" }),
      "purpose must be login or signup."
    );
    expectAuthError(
      () => parseStartBody({ identifier: "not-an-email", purpose: "signup" }),
      "identifier must be a valid email."
    );
  });

  it("parses auth verify bodies", () => {
    expect(parseVerifyBody({
      challengeId: "otp_123",
      code: "A1b2C3"
    })).toEqual({
      challengeId: "otp_123",
      code: "A1b2C3"
    });
  });

  it("preserves auth verify validation errors", () => {
    expectAuthError(
      () => parseVerifyBody([]),
      "Auth verify body must be a JSON object."
    );
    expectAuthError(
      () => parseVerifyBody({ challengeId: "otp_123", code: "!!!" }),
      "code must be an alphanumeric string between 6 and 32 characters."
    );
    expectAuthError(
      () => parseVerifyBody({ code: "A1b2C3" }),
      "challengeId is required."
    );
  });
});
