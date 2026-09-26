import { describe, expect, it } from "vitest";

import {
  isMarketTagEligible,
  suggestMarketTags
} from "../../src/markets/market-tags/tag-suggestions";

describe("market tag suggestions", () => {
  it("combines category, family, and title keywords using the controlled vocabulary", () => {
    expect(
      suggestMarketTags({
        id: "disc-boi-rate-september",
        title: "החלטת הריבית של בנק ישראל בספטמבר",
        category_key: "economy",
        market_family_key: "boi-rate-decision-v1"
      }).map((tag) => ({ slug: tag.def.slug, weight: tag.weight }))
    ).toEqual([
      { slug: "bank-of-israel", weight: 10 },
      { slug: "interest-rate", weight: 10 },
      { slug: "economy", weight: 0 }
    ]);
  });

  it("adds FIFA world cup tags to real match-winner markets", () => {
    expect(
      suggestMarketTags({
        id: "disc-fifa-france-sweden-2026-07-09",
        title: "צרפת נגד שוודיה",
        category_key: "sports",
        market_family_key: "sports-match-winner-v1"
      }).map((tag) => tag.def.slug)
    ).toEqual(["football", "world-cup-2026", "sports"]);
  });

  it("excludes test and junk families unless the family is curated", () => {
    expect(
      isMarketTagEligible({
        id: "disc-gauntlet-test",
        title: "בדיקת גרף",
        category_key: "sports",
        market_family_key: "graph-test-v1"
      })
    ).toBe(false);
  });
});
