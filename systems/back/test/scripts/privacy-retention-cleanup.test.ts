import { describe, expect, it } from "vitest";

import { parsePrivacyRetentionCleanupArgs } from "../../src/scripts/privacy-retention-cleanup";

describe("privacy retention cleanup CLI args", () => {
  it("defaults to a dry-run cleanup with default policy", () => {
    expect(parsePrivacyRetentionCleanupArgs([])).toEqual({
      execute: false,
      json: false,
      policy: {
        otpExpiredDays: undefined,
        otpFinalizedDays: undefined,
        sessionExpiredDays: undefined,
        accountDeletionRequestDays: undefined,
        auditEventDays: undefined,
        riskSignalDefaultDays: undefined,
        riskSignalReviewedDays: undefined,
        feedbackClosedDays: undefined,
        avatarOrphanDays: undefined
      }
    });
  });

  it("parses execute, json, and policy overrides", () => {
    expect(parsePrivacyRetentionCleanupArgs([
      "--execute",
      "--json",
      "--otp-expired-days=14",
      "--session-expired-days",
      "21",
      "--audit-event-days=365"
    ])).toMatchObject({
      execute: true,
      json: true,
      policy: {
        otpExpiredDays: 14,
        sessionExpiredDays: 21,
        auditEventDays: 365
      }
    });
  });

  it("rejects invalid day overrides", () => {
    expect(() => parsePrivacyRetentionCleanupArgs(["--otp-expired-days=0"]))
      .toThrow("--otp-expired-days must be a positive integer day count.");
    expect(() => parsePrivacyRetentionCleanupArgs(["--audit-event-days=abc"]))
      .toThrow("--audit-event-days must be a positive integer day count.");
  });
});
