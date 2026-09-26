import { describe, expect, it } from "vitest";

import { buildSources } from "../../../../oracle/src/oracle-cli-args";

describe("buildSources", () => {
  it("normalizes HTTPS source URLs from CLI flags", () => {
    const sources = buildSources(
      new Map([
        ["source-url", " https://example.com/result "],
        ["source-label", "Official result"],
        ["claim-summary", "Example won."]
      ])
    );

    expect(sources).toMatchObject([
      {
        sourceUrl: "https://example.com/result",
        sourceLabel: "Official result",
        claimSummary: "Example won."
      }
    ]);
  });

  it.each(["javascript:alert(1)", "http://example.com/result"])(
    "rejects unsafe CLI source URL %s",
    (sourceUrl) => {
      expect(() => buildSources(new Map([["source-url", sourceUrl]]))).toThrowError(
        /--source-url must be an HTTPS URL/
      );
    }
  );

  it("rejects unsafe URLs in a pipe-delimited CLI source list", () => {
    expect(() =>
      buildSources(
        new Map([
          ["source-url", "https://example.com/result|javascript:alert(1)"],
          ["source-label", "Official|Unsafe"],
          ["claim-summary", "Official result|Unsafe result"]
        ])
      )
    ).toThrowError(/--source-url must be an HTTPS URL/);
  });
});
