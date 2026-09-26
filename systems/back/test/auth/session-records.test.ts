import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";

import { hashValue } from "../../src/auth/session/hashing";
import { readClientFingerprint } from "../../src/auth/session/session-records";

function makeRequest(remoteAddress: string, headers: Record<string, string> = {}): IncomingMessage {
  return {
    headers,
    socket: {
      remoteAddress
    }
  } as IncomingMessage;
}

describe("session client fingerprinting", () => {
  it("ignores spoofed X-Forwarded-For from untrusted socket peers", () => {
    const fingerprint = readClientFingerprint(
      makeRequest("45.77.10.20", {
        "x-forwarded-for": "203.0.113.5",
        "user-agent": "test-browser"
      })
    );

    expect(fingerprint.ipHash).toBe(hashValue("45.77.10.20"));
    expect(fingerprint.ipHash).not.toBe(hashValue("203.0.113.5"));
    expect(fingerprint.userAgentHash).toBe(hashValue("test-browser"));
  });

  it("uses X-Forwarded-For when the socket peer is a trusted proxy", () => {
    const fingerprint = readClientFingerprint(
      makeRequest("127.0.0.1", {
        "x-forwarded-for": "203.0.113.5, 198.51.100.7"
      })
    );

    expect(fingerprint.ipHash).toBe(hashValue("203.0.113.5"));
  });
});
