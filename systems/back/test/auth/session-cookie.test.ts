import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";

import { readCookie } from "../../src/auth/session-cookie";

describe("session cookie parsing", () => {
  it("does not throw on malformed percent-encoded cookie values", () => {
    const request = {
      headers: {
        cookie: "navi_session=%E0%A4%A"
      }
    } as IncomingMessage;

    expect(() => readCookie(request, "navi_session")).not.toThrow();
    expect(readCookie(request, "navi_session")).toBe("%E0%A4%A");
  });

  it("uses the first session cookie value when duplicate cookie names are present", () => {
    const request = {
      headers: {
        cookie: "navi_session=trusted; theme=dark; navi_session=shadow"
      }
    } as IncomingMessage;

    expect(readCookie(request, "navi_session")).toBe("trusted");
  });
});
