import { describe, expect, it } from "vitest";

import {
  findWinningOutcomeForInspection
} from "../../../../oracle/src/official-final-context";
import type {
  OracleLifecycleSourceContext,
  OracleSourceInspection
} from "../../../../oracle/src/source-adapter-contracts";

describe("official final outcome mapping", () => {
  it("maps a range evidence key to the exact contract outcome", () => {
    const marketId = "disc-weather-tel-aviv-high-temp-2026-08-03";
    const context = {
      marketId,
      marketContract: {
        objectType: "market_contract_v1",
        outcomeMap: [
          {
            evidenceKey: "range-29-29.9",
            outcomeLabel: "29°C",
            resolutionPath: "Wins from 29.0°C through 29.9°C."
          },
          {
            evidenceKey: "range-32-32.9",
            outcomeLabel: "32°C",
            resolutionPath: "Wins from 32.0°C through 32.9°C."
          }
        ]
      }
    } as OracleLifecycleSourceContext;
    const outcomes = [
      { id: `${marketId}-outcome-29-c`, label: "29°C" },
      { id: `${marketId}-outcome-32-c`, label: "32°C" }
    ];
    const inspection = {
      evidenceKey: "range-32-32.9",
      winnerLabel: "32°C"
    } as OracleSourceInspection;

    expect(findWinningOutcomeForInspection(context, outcomes, inspection)).toEqual(
      outcomes[1]
    );
  });
});
