import { describe, expect, it } from "vitest";

import { curateMarketImage } from "../../../seer/src/market-image";

describe("curateMarketImage", () => {
  it("prefers entity images for crypto markets", () => {
    expect(
      curateMarketImage({
        question: "האם ביטקוין יסגור מעל 80,000 דולר?",
        category: "crypto",
        sourceIds: ["src_coinbase_exchange_candles"]
      })
    ).toMatchObject({
      bucket: "entity",
      alt: "ביטקוין",
      provenance: "entity:bitcoin",
      assetId: "bucket.crypto.default.v1",
      theme: {
        source: "category"
      }
    });
  });

  it("uses the BoI entity image when the market mentions it", () => {
    // Bank of Israel is now an entity-level asset (entity.bank-of-israel.v1)
    // and points at the owned economy SVG. Entity beats source in the
    // BUCKET_PRIORITY ladder, so any BoI-mentioning market gets the entity
    // choice.
    expect(
      curateMarketImage({
        question: "האם בנק ישראל יוריד ריבית במאי?",
        category: "economy",
        sourceIds: ["src_boi_announcements"]
      })
    ).toMatchObject({
      bucket: "entity",
      alt: "בנק ישראל",
      // BoI icon now points at economy.svg (the chart-bars bucket) rather
      // than source.svg — BoI is canonically an economy entity, and the
      // shield/source SVG read as "generic official source" on the card.
      src: "/assets/images/market-buckets/economy.svg",
      assetId: "entity.bank-of-israel.v1",
      provenance: "entity:bank-of-israel",
      rights: {
        status: "hachozeh-owned",
        publicUse: "allowed"
      }
    });
  });

  it("uses event images ahead of source logos when the happening is the clearer visual subject", () => {
    expect(
      curateMarketImage({
        question: "האם הטמפרטורה המקסימלית בתל אביב תגיע ל-30 מעלות?",
        category: "weather",
        sourceIds: ["src_ims_daily_observations"]
      })
    ).toMatchObject({
      bucket: "event",
      alt: "מזג אוויר בתל אביב",
      provenance: "event:weather-city",
      assetId: "bucket.weather.default.v1",
      rights: {
        status: "hachozeh-owned",
        publicUse: "allowed"
      }
    });
  });

  it("uses event images for sports matchups without a known entity logo", () => {
    expect(
      curateMarketImage({
        question: "מה תהיה התוצאה הרשמית: סלובן ברטיסלבה נגד מיכלובצה?",
        category: "sports",
        sourceIds: ["src_nike_liga_official"]
      })
    ).toMatchObject({
      bucket: "event",
      alt: "משחק ספורט",
      provenance: "event:sports-match"
    });
  });

  it("recognizes more crypto entities before falling back to source or category art", () => {
    expect(
      curateMarketImage({
        question: "האם מחיר סולנה יעלה בנר השעה?",
        category: "crypto"
      })
    ).toMatchObject({
      bucket: "entity",
      alt: "סולנה",
      provenance: "entity:solana",
      src: "/assets/images/market-buckets/crypto.svg",
      rights: {
        status: "hachozeh-owned",
        publicUse: "allowed"
      }
    });
  });

  it("falls back to category when no entity, event, or source matches", () => {
    expect(
      curateMarketImage({
        question: "האם יקרה אירוע כללי?",
        category: "sports"
      })
    ).toMatchObject({
      bucket: "category-fallback",
      alt: "ספורט",
      provenance: "category_fallback:sports"
    });
  });

  it("has owned fallbacks for product and live-intake categories", () => {
    expect(curateMarketImage({ question: "האם חוק חדש יעבור?", category: "legislation" })).toMatchObject({
      bucket: "category-fallback",
      src: "/assets/images/market-buckets/legislation.svg",
      rights: {
        status: "hachozeh-owned",
        publicUse: "allowed"
      }
    });

    expect(curateMarketImage({ question: "האם אזהרת נסיעה תשתנה?", category: "travel" })).toMatchObject({
      bucket: "category-fallback",
      src: "/assets/images/market-buckets/travel.svg",
      rights: {
        status: "hachozeh-owned",
        publicUse: "allowed"
      }
    });

    expect(curateMarketImage({ question: "האם חברה ציבורית תכה את תחזית הרווח?", category: "companies" })).toMatchObject({
      bucket: "category-fallback",
      src: "/assets/images/market-buckets/business.svg",
      alt: "עסקים",
      assetId: "bucket.business.default.v1"
    });

    expect(curateMarketImage({ question: "האם מודל AI חדש יושק?", category: "ai" })).toMatchObject({
      bucket: "category-fallback",
      src: "/assets/images/market-buckets/ai.svg",
      alt: "בינה מלאכותית"
    });

    expect(curateMarketImage({ question: "האם מדינה תפרסם הסכם חדש?", category: "geopolitics" })).toMatchObject({
      bucket: "category-fallback",
      src: "/assets/images/market-buckets/world.svg",
      alt: "עולם"
    });

    expect(curateMarketImage({ question: "האם משחק איספורט יסתיים בגמר?", category: "esports" })).toMatchObject({
      bucket: "category-fallback",
      src: "/assets/images/market-buckets/esports.svg",
      alt: "איספורט"
    });
  });
});
