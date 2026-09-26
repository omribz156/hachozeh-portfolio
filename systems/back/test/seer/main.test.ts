import { describe, expect, it } from "vitest";

import { parseLifecycleCapabilities, renderContractHumanLines, renderScanHumanSummary } from "../../../seer/src/main";
import { duplicatePressureSignals } from "../../../seer/src/test-fixtures";

describe("renderScanHumanSummary", () => {
  it("groups raw signals into card-level scan rows for human output", () => {
    const summary = renderScanHumanSummary(duplicatePressureSignals);

    expect(summary).toContain("cards: 3");
    expect(summary).toContain("raw signals: 3");
    expect(summary).toContain("Bank of Israel March 2026 rate decision");
    expect(summary).toContain("lane=planned");
    expect(summary).toContain("category=economy");
    expect(summary).toContain("marketability=already-shaped");
    expect(summary).not.toContain("signalOrigin");
  });
});

describe("renderContractHumanLines", () => {
  it("puts contract source, timeline, rule, outcomes, and blockers up front", () => {
    const lines = renderContractHumanLines({
      objectType: "market_contract_v1",
      version: "seer-contract-v1",
      measurement: "Will the BOI hold rates?",
      resolutionAuthorityType: "official",
      resolutionSource: {
        label: "Bank of Israel",
        url: "https://www.boi.org.il/",
        sourceIds: ["src_boi_announcements"]
      },
      resolutionRule: "Official BOI announcement settles the market.",
      timeline: {
        closeShape: "Close before May 25, 2026 at 16:00.",
        closeAt: "2026-05-25T16:00:00.000Z",
        timezone: "UTC"
      },
      outcomeMap: [
        {
          outcomeLabel: "ללא שינוי",
          outcomeKind: "named-outcome",
          resolutionPath: "Wins if the official result is no change."
        }
      ],
      delayPolicy: "Wait for official verification.",
      reviewBlockers: [],
      sourceRolePlan: {
        wake: ["BOI"],
        ground: ["BOI"],
        resolve: ["BOI"]
      }
    });

    expect(lines.join("\n")).toContain("source: Bank of Israel | https://www.boi.org.il/");
    expect(lines.join("\n")).toContain("timeline: Close before May 25, 2026 at 16:00.");
    expect(lines.join("\n")).toContain("rule: Official BOI announcement settles the market.");
    expect(lines.join("\n")).toContain("outcomes: ללא שינוי");
    expect(lines.join("\n")).toContain("blockers: none");
  });
});

describe("parseLifecycleCapabilities", () => {
  it("parses source-add lifecycle capability triples for registry seeding", () => {
    expect(
      parseLifecycleCapabilities(
        "rate_direction/cut_hold_hike/manual_resolution_required|final_winner/home_away_winner/supported_full_cycle"
      )
    ).toEqual([
      {
        measurementKind: "rate_direction",
        resultShape: "cut_hold_hike",
        oracleCapability: "manual_resolution_required"
      },
      {
        measurementKind: "final_winner",
        resultShape: "home_away_winner",
        oracleCapability: "supported_full_cycle"
      }
    ]);
  });

  it("rejects invalid lifecycle capability values", () => {
    expect(() => parseLifecycleCapabilities("rate_direction/nope/manual_resolution_required")).toThrow(
      /Invalid --lifecycle/
    );
  });
});
