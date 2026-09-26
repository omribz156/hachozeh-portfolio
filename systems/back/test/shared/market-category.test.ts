import { describe, expect, it } from "vitest";

import { readMarketCategoryMeta } from "../../src/shared/market-category";

describe("market category metadata", () => {
  it("has display assets and registry themes for public and Seer intake categories", () => {
    const categories = [
      "economics",
      "business",
      "companies",
      "company",
      "politics",
      "world",
      "geopolitics",
      "geopolitical",
      "legislation",
      "sports",
      "esports",
      "e-sports",
      "crypto",
      "fx",
      "commodities",
      "commodity",
      "weather",
      "technology",
      "ai",
      "artificial-intelligence",
      "culture",
      "entertainment",
      "awards",
      "social",
      "mentions",
      "security",
      "travel",
      "transportation",
      "transport",
      "science",
      "health",
      "pandemics",
      "pandemic",
      "education",
      "schools",
      "school",
      "energy",
      "fuel",
      "oil",
      "general"
    ];

    for (const category of categories) {
      expect(readMarketCategoryMeta(category)).toMatchObject({
        // brandImageUrl must be a local registry SVG bucket — no hosted URLs.
        // The old BAKED_DISPLAY_IMAGE_BY_CATEGORY table that allowed
        // images.unsplash.com / lh3.googleusercontent.com was removed because
        // it bypassed Seer curation and surfaced random photos on cards.
        brandImageUrl: expect.stringMatching(/^\/assets\/images\/market-buckets\/.+\.svg$/),
        theme: {
          primary: expect.stringMatching(/^#/),
          secondary: expect.stringMatching(/^#/),
          source: "category"
        }
      });
    }
  });

  it("returns local registry bucket SVGs for previously-baked categories", () => {
    expect(readMarketCategoryMeta("economics")?.brandImageUrl).toBe(
      "/assets/images/market-buckets/economy.svg"
    );
    expect(readMarketCategoryMeta("politics")?.brandImageUrl).toBe(
      "/assets/images/market-buckets/politics.svg"
    );
    expect(readMarketCategoryMeta("sports")?.brandImageUrl).toBe(
      "/assets/images/market-buckets/sports.svg"
    );
    expect(readMarketCategoryMeta("crypto")?.brandImageUrl).toBe(
      "/assets/images/market-buckets/crypto.svg"
    );
    expect(readMarketCategoryMeta("weather")?.brandImageUrl).toBe(
      "/assets/images/market-buckets/weather.svg"
    );
    expect(readMarketCategoryMeta("education")).toMatchObject({
      frontendKey: "education",
      label: "חינוך",
      brandImageUrl: "/assets/images/market-buckets/education.svg"
    });
    expect(readMarketCategoryMeta("energy")).toMatchObject({
      frontendKey: "energy",
      label: "אנרגיה",
      brandImageUrl: "/assets/images/market-buckets/energy.svg"
    });
  });
});
