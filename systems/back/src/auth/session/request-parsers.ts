import { z } from "zod";

import {
  parseObjectBody,
  parseRequiredStringField
} from "../../shared/zod-request-body";
import { normalizeEmail } from "../email-identity";
import { AuthSessionError } from "./errors";
import type { AuthPurpose } from "./types";

const createAuthRequestError = (message: string) =>
  new AuthSessionError(400, "invalid_request", message);

const AuthPurposeSchema = z.enum(["login", "signup"]);
const ChallengeIdSchema = z.string().regex(/^otp_[A-Za-z0-9_-]{1,80}$/);
const OtpCodeSchema = z.string().regex(/^[A-Za-z0-9]{6,32}$/);

export function parseStartBody(body: unknown): {
  identifier: string;
  purpose: AuthPurpose;
} {
  const record = parseObjectBody(
    body,
    "Auth start body must be a JSON object.",
    createAuthRequestError
  );

  const rawPurpose = parseRequiredStringField(record, "purpose", createAuthRequestError);
  const purpose = AuthPurposeSchema.safeParse(rawPurpose);

  if (!purpose.success) {
    throw new AuthSessionError(400, "invalid_request", "purpose must be login or signup.");
  }

  return {
    identifier: (() => {
      try {
        return normalizeEmail(
          parseRequiredStringField(record, "identifier", createAuthRequestError)
        );
      } catch {
        throw new AuthSessionError(400, "invalid_request", "identifier must be a valid email.");
      }
    })(),
    purpose: purpose.data
  };
}

export function parseVerifyBody(body: unknown): {
  challengeId: string;
  code: string;
} {
  const record = parseObjectBody(
    body,
    "Auth verify body must be a JSON object.",
    createAuthRequestError
  );

  const code = parseRequiredStringField(record, "code", createAuthRequestError);
  const challengeId = parseRequiredStringField(record, "challengeId", createAuthRequestError);

  if (!ChallengeIdSchema.safeParse(challengeId).success) {
    throw new AuthSessionError(
      400,
      "invalid_request",
      "challengeId must be a valid OTP challenge id."
    );
  }

  if (!OtpCodeSchema.safeParse(code).success) {
    throw new AuthSessionError(
      400,
      "invalid_request",
      "code must be an alphanumeric string between 6 and 32 characters."
    );
  }

  return {
    challengeId,
    code
  };
}
