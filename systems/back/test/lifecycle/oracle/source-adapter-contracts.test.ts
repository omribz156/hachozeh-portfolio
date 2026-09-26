import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertSafeOracleAdapterUrl,
  fetchOracleAdapterJson,
  fetchOracleAdapterText,
  isAllowedOracleAdapterHost
} from "../../../../oracle/src/source-adapter-contracts";

const originalFetch = globalThis.fetch;

function mockFetch(response: Response): void {
  globalThis.fetch = vi.fn(async () => response) as typeof fetch;
}

function mockFetchSequence(responses: Response[]): void {
  let index = 0;
  globalThis.fetch = vi.fn(async () => {
    return responses[Math.min(index++, responses.length - 1)];
  }) as typeof fetch;
}

function createAbortAwareMockFetch(handler: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>): void {
  globalThis.fetch = vi.fn(async (input, init) => handler(input, init)) as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("oracle adapter safe fetch boundary", () => {
  it("rejects non-https URLs before fetch", async () => {
    expect(() => assertSafeOracleAdapterUrl("http://api.example.test/result.json")).toThrow(
      /must use https/
    );
    await expect(fetchOracleAdapterText("http://api.example.test/result.json")).rejects.toThrow(
      /must use https/
    );
  });

  it("rejects loopback and private IP URLs before fetch", async () => {
    await expect(fetchOracleAdapterText("https://127.0.0.1/admin")).rejects.toThrow(
      /blocked network/
    );
    expect(() => assertSafeOracleAdapterUrl("https://[::1]/admin")).toThrow(/blocked network/);
    await expect(fetchOracleAdapterText("https://[::ffff:127.0.0.1]/admin")).rejects.toThrow(
      /blocked network/
    );
    await expect(fetchOracleAdapterText("https://10.0.0.4/metadata")).rejects.toThrow(
      /blocked network/
    );
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("rejects credentialed URL inputs before fetch", async () => {
    await expect(
      fetchOracleAdapterText("https://user:pass@203.0.113.10/result")
    ).rejects.toThrow(/must not include credentials/);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("rejects public-to-private redirects", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "https://10.10.10.10/result"
        }
      }),
      new Response("ok")
    ]);

    await expect(fetchOracleAdapterText("https://203.0.113.10/result")).rejects.toThrow(/blocked network/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-allowlist redirects", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "https://198.51.100.20/result"
        }
      }),
      new Response("ok")
    ]);

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result", {
        allowedHosts: ["203.0.113.10"]
      })
    ).rejects.toThrow(/host is not allowed/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("follows relative redirects to a final safe hop", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "/result?page=2"
        }
      }),
      new Response("{}")
    ]);

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result?page=1", { maxBytes: 20 })
    ).resolves.toEqual("{}");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    const firstCallUrl = globalThis.fetch.mock.calls[0]?.[0];
    expect(String(firstCallUrl)).toBe("https://203.0.113.10/result?page=1");
    const secondCallUrl = globalThis.fetch.mock.calls[1]?.[0];
    expect(String(secondCallUrl)).toBe("https://203.0.113.10/result?page=2");
  });

  it("rejects when redirect depth is exceeded", async () => {
    mockFetchSequence([
      new Response("", {
        status: 302,
        headers: {
          location: "/result?page=2"
        }
      })
    ]);

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result?page=1")
    ).rejects.toThrow(/exceeded redirect limit/);
  });

  it("cancels redirect response body when redirect location is missing", async () => {
    const cancelSpy = vi.spyOn(ReadableStream.prototype, "cancel").mockResolvedValue(undefined);
    mockFetch(new Response("", { status: 302 }));

    await expect(fetchOracleAdapterText("https://203.0.113.10/result")).rejects.toThrow(
      /missing redirect location/
    );
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    cancelSpy.mockRestore();
  });

  it("allows direct POST responses without redirects", async () => {
    mockFetch(new Response("{}", { status: 200 }));

    await expect(
      fetchOracleAdapterJson("https://203.0.113.10/result", {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: "{}"
      })
    ).resolves.toEqual({});
  });

  it("rejects POST redirects before any second fetch", async () => {
    const cancelSpy = vi.spyOn(ReadableStream.prototype, "cancel").mockResolvedValue(undefined);
    mockFetch(new Response("", {
      status: 302,
      headers: {
        location: "/result"
      }
    }));

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result", {
        method: "POST",
        body: "{}"
      })
    ).rejects.toThrow(/method does not allow redirect follow/);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    cancelSpy.mockRestore();
  });

  it("uses one timeout budget across hops", async () => {
    const timeoutMs = 40;
    createAbortAwareMockFetch(async (_url, init) => {
      if ((globalThis.fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length === 1) {
        return new Response("", {
          status: 302,
          headers: {
            location: "https://203.0.113.10/slow"
          }
        });
      }

      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (!signal) {
          return setTimeout(() => reject(new Error("missing signal")), timeoutMs * 2);
        }

        const done = () => {
          reject(new Error("marketwatch timeout should abort request"));
        };

        if (signal.aborted) {
          done();
          return;
        }

        signal.addEventListener("abort", done, { once: true });
      });
    });

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result", { timeoutMs })
    ).rejects.toBeTruthy();
  });

  it("rejects when hostname DNS lookup exceeds deadline", async () => {
    const timeoutMs = 20;
    const lookup = vi.fn(async (_hostname: string, _init: { all: true }) => {
      if (lookup.mock.calls.length === 1) {
        return [{ address: "203.0.113.10", family: 4 }];
      }

      return new Promise(() => {});
    });

    mockFetch(new Response("", {
      status: 302,
      headers: {
        location: "/result"
      }
    }));

    await expect(
      fetchOracleAdapterText("https://oracle.example.test/result", {
        timeoutMs,
        lookup
      })
    ).rejects.toThrow("Oracle adapter fetch request timed out.");
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("rejects oversized responses from content-length", async () => {
    mockFetch(
      new Response("{}", {
        headers: {
          "content-length": "50"
        }
      })
    );

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result", { maxBytes: 10 })
    ).rejects.toThrow(/too large/);
  });

  it("rejects oversized streamed responses", async () => {
    mockFetch(new Response("0123456789abcdef"));

    await expect(
      fetchOracleAdapterText("https://203.0.113.10/result", { maxBytes: 10 })
    ).rejects.toThrow(/too large/);
  });

  it("parses bounded JSON responses", async () => {
    mockFetch(new Response(JSON.stringify({ status: "final" })));

    await expect(
      fetchOracleAdapterJson("https://203.0.113.10/result", { maxBytes: 100 })
    ).resolves.toEqual({ status: "final" });
  });

  it("rejects URLs outside a source host allowlist", async () => {
    await expect(
      fetchOracleAdapterJson("https://evil.example.test/result", {
        allowedHosts: ["api.example.test"]
      })
    ).rejects.toThrow(/host is not allowed/);
    expect(globalThis.fetch).toBe(originalFetch);
  });

  it("allows exact and suffix host allowlist matches", () => {
    expect(isAllowedOracleAdapterHost("api.example.test", ["api.example.test"])).toBe(true);
    expect(isAllowedOracleAdapterHost("stats.example.test", [".example.test"])).toBe(true);
    expect(isAllowedOracleAdapterHost("evil.test", [".example.test"])).toBe(false);
  });
});
