import { describe, expect, it } from "vitest";

import { buildChainItems } from "./chain-reader";
import type { MarketFamilyRow } from "./types";

function familyRow(
  market_id: string,
  close_at: string,
  status = "open"
): MarketFamilyRow {
  return {
    market_id,
    event_slug: `event-${market_id}`,
    status,
    close_at: new Date(close_at),
    label_at: new Date(close_at)
  };
}

describe("market detail family chain", () => {
  it("keeps earlier open siblings active when viewing a later market", () => {
    const items = buildChainItems(
      [
        familyRow("july-1", "2026-07-01T13:00:00.000Z"),
        familyRow("july-2", "2026-07-02T13:00:00.000Z"),
        familyRow("july-3", "2026-07-03T13:00:00.000Z"),
        familyRow("july-4", "2026-07-04T13:00:00.000Z")
      ],
      "july-4"
    );

    expect(items.map((item) => [item.id, item.temporalStatus])).toEqual([
      ["july-1", "future"],
      ["july-2", "future"],
      ["july-3", "future"],
      ["july-4", "current"]
    ]);
  });

  it("puts closed and resolved siblings in past", () => {
    const items = buildChainItems(
      [
        familyRow("closed-market", "2026-07-01T13:00:00.000Z", "closed"),
        familyRow("resolved-market", "2026-07-02T13:00:00.000Z", "resolved"),
        familyRow("open-market", "2026-07-03T13:00:00.000Z", "open")
      ],
      "open-market"
    );

    expect(items.map((item) => [item.id, item.temporalStatus])).toEqual([
      ["closed-market", "past"],
      ["resolved-market", "past"],
      ["open-market", "current"]
    ]);
  });
});
