import { describe, expect, it } from "vitest";

import {
  buildPriceImpact,
  classifyPriceImpactPercentPoints
} from "../../../src/engine/pricing";

describe("price impact", () => {
  it("classifies impact bands from percent-point movement", () => {
    expect(classifyPriceImpactPercentPoints(0.9)).toBe("low");
    expect(classifyPriceImpactPercentPoints(1)).toBe("medium");
    expect(classifyPriceImpactPercentPoints(5)).toBe("high");
    expect(classifyPriceImpactPercentPoints(15)).toBe("extreme");
  });

  it("reports direction and absolute impact", () => {
    expect(buildPriceImpact("0.16000000", "0.22458200")).toEqual({
      delta: "0.06458200",
      absDelta: "0.06458200",
      percentPoints: "6.4582",
      level: "high",
      direction: "up"
    });

    expect(buildPriceImpact("0.84000000", "0.80000000")).toMatchObject({
      delta: "-0.04000000",
      absDelta: "0.04000000",
      percentPoints: "4.0000",
      level: "medium",
      direction: "down"
    });
  });
});
