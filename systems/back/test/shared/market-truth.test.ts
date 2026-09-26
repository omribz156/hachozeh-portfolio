import { describe, expect, it } from "vitest";

import {
  buildPublicMarketContract,
  readContractMarketImage
} from "../../src/shared/market-truth";

function contractWithImage(image: Record<string, unknown>) {
  return {
    objectType: "market_contract_v1",
    image
  };
}

describe("readContractMarketImage", () => {
  it("returns contract images that are approved for public use", () => {
    expect(
      readContractMarketImage(
        contractWithImage({
          bucket: "source",
          src: "/assets/images/market-buckets/source.svg",
          alt: "מקור רשמי",
          provenance: "source:neutral",
          rights: {
            status: "hachozeh-owned",
            publicUse: "allowed",
            owner: "Hachozeh"
          },
          theme: {
            primary: "#6ee7b7",
            secondary: "#f7c66a",
            surface: "#17212d",
            accentReason: "source-neutral",
            source: "source-neutral"
          }
        })
      )
    ).toEqual({
      src: "/assets/images/market-buckets/source.svg",
      alt: "מקור רשמי",
      theme: {
        primary: "#6ee7b7",
        secondary: "#f7c66a",
        surface: "#17212d",
        accentReason: "source-neutral",
        source: "source-neutral"
      }
    });
  });

  it("rejects legacy or unverified third-party images from public feeds", () => {
    expect(
      readContractMarketImage(
        contractWithImage({
          bucket: "source",
          src: "https://www.boi.org.il/favicon.ico",
          alt: "בנק ישראל",
          provenance: "source:bank-of-israel"
        })
      )
    ).toBeNull();

    expect(
      readContractMarketImage(
        contractWithImage({
          bucket: "source",
          src: "https://www.boi.org.il/favicon.ico",
          alt: "בנק ישראל",
          provenance: "source:bank-of-israel",
          rights: {
            status: "unverified",
            publicUse: "blocked",
            owner: "Bank of Israel"
          }
        })
      )
    ).toBeNull();
  });
});

describe("buildPublicMarketContract", () => {
  it("exposes display hints for named-opponent binary markets", () => {
    expect(
      buildPublicMarketContract({
        objectType: "market_contract_v1",
        displayHints: {
          binaryPresentation: "named_opponents",
          affirmativeLabel: "סן אנטוניו ספרס",
          negativeLabel: "אוקלהומה סיטי ת'אנדר"
        }
      })
    ).toMatchObject({
      displayHints: {
        binaryPresentation: "named_opponents",
        affirmativeLabel: "סן אנטוניו ספרס",
        negativeLabel: "אוקלהומה סיטי ת'אנדר"
      }
    });
  });

  it("maps public contract source URLs away from machine-only Winner League JSON endpoints", () => {
    expect(
      buildPublicMarketContract({
        objectType: "market_contract_v1",
        resolutionSource: {
          label: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל",
          url: "https://basket.co.il/pbp/json/games_all.json#game-26515",
          sourceIds: ["src_winner_league_basketball"]
        },
        resolutionRule:
          "מקור ההכרעה: https://basket.co.il/pbp/json/games_all.json#game-26515",
        sourceRolePlan: {
          resolve: [
            "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/pbp/json/games_all.json#game-26515"
          ]
        }
      })
    ).toMatchObject({
      resolutionSource: {
        label: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל",
        url: "https://basket.co.il/game-zone.asp?GameId=26515#!stats",
        sourceIds: ["src_winner_league_basketball"]
      },
      resolutionRule: "מקור ההכרעה: https://basket.co.il/game-zone.asp?GameId=26515#!stats",
      sourceRolePlan: {
        resolve: [
          "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל: https://basket.co.il/game-zone.asp?GameId=26515#!stats"
        ]
      }
    });
  });

  it("localizes known source labels and legacy delay policy defaults for public contracts", () => {
    expect(
      buildPublicMarketContract({
        objectType: "market_contract_v1",
        resolutionSource: {
          label: "Bank of Israel interest rate announcement dates and publications",
          url: "https://www.boi.org.il/",
          sourceIds: ["src_boi_announcements"]
        },
        delayPolicy:
          "If the resolution source is delayed or ambiguous, keep the market pending until a human reviewer verifies the official result."
      })
    ).toMatchObject({
      resolutionSource: {
        label: "פרסומי בנק ישראל",
        url: "https://www.boi.org.il/",
        sourceIds: ["src_boi_announcements"]
      },
      delayPolicy:
        "אם המקור הרשמי מתעכב או לא ברור, השוק נשאר בהמתנה עד שמפעיל מאמת את התוצאה הרשמית."
    });
  });

  it("expands generic FIFA labels to the official match page source label", () => {
    expect(
      buildPublicMarketContract({
        objectType: "market_contract_v1",
        resolutionSource: {
          label: "פיפ״א",
          url: "https://www.fifa.com/en/match-centre/match/17/285023/289287/400021516",
          sourceIds: ["src_fifa_match_centre"]
        }
      })
    ).toMatchObject({
      resolutionSource: {
        label: "פיפ״א, עמוד המשחק הרשמי",
        url: "https://www.fifa.com/en/match-centre/match/17/285023/289287/400021516",
        sourceIds: ["src_fifa_match_centre"]
      }
    });
  });
});
