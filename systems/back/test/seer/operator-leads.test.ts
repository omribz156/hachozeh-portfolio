import { describe, expect, it } from "vitest";

import { buildOperatorLead } from "../../../seer/src/operator-leads";

describe("operator leads", () => {
  it("normalizes an external market lead into a receipt, not a market lane", () => {
    const lead = buildOperatorLead(
      {
        createdBy: "omri",
        leadUrl: "https://polymarket.com/event/example",
        leadSourceType: "external_market",
        leadRole: "shape_reference",
        rawPrompt: "Use this close-EOL market as a shape reference.",
        initialDomain: "sports",
        expectedLane: "shock-discovery",
        externalQuestion: "Will Team A beat Team B?",
        externalOutcomes: ["Yes", "No"],
        externalCloseTime: "tonight",
        externalRules: "External visible rule text.",
        externalSourceRefs: ["https://example.test/source"],
        trainingUse: "close-EOL comparison",
        notes: ["not_resolution_source"]
      },
      "2026-05-09T12:00:00.000Z"
    );

    expect(lead).toMatchObject({
      objectType: "operator_lead",
      createdBy: "omri",
      leadSourceType: "external_market",
      leadRole: "shape_reference",
      expectedLane: "live",
      status: "new",
      rawPrompt: "Use this close-EOL market as a shape reference."
    });
    expect(lead.externalOutcomes).toEqual(["Yes", "No"]);
    expect(lead.notes).toContain("not_resolution_source");
  });
});
