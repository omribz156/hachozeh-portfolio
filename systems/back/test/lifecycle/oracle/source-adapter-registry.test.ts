import { describe, expect, it } from "vitest";

import {
  classifyOracleLifecycleSupport,
  findOracleLifecycleSourceAdapter
} from "../../../../oracle/src/source-adapter-registry";
import { COINBASE_CANDLES_SOURCE_ADAPTER } from "../../../../oracle/src/adapters/coinbase-candles-source-adapter";
import type {
  OracleLifecycleSourceAdapter,
  OracleLifecycleSourceContext
} from "../../../../oracle/src/source-adapter-contracts";

const BASE_CONTEXT: OracleLifecycleSourceContext = {
  marketId: "disc-cm-proof",
  marketTitle: "מי תנצח?",
  marketStatus: "open",
  closeAt: "2026-05-09T16:00:00.000Z",
  closeOnEventCompletion: true,
  eventCompletionCloseRequiresHumanApproval: true,
  resolutionSource: "https://example.invalid/match/1",
  resolutionRules: "Resolve from the official source.",
  oracleSourcePolicy: null,
  marketContract: null,
  outcomes: [
    {
      outcomeId: "disc-cm-proof-home",
      outcomeKey: "disc-cm-proof-home",
      label: "בית"
    },
    {
      outcomeId: "disc-cm-proof-draw",
      outcomeKey: "disc-cm-proof-draw",
      label: "תיקו"
    },
    {
      outcomeId: "disc-cm-proof-away",
      outcomeKey: "disc-cm-proof-away",
      label: "חוץ"
    }
  ]
};

function adapter(overrides: Partial<OracleLifecycleSourceAdapter>): OracleLifecycleSourceAdapter {
  return {
    sourceFamily: "test_family",
    sourceLabel: "Test family",
    sourceIds: ["src_test_family"],
    measurementKinds: ["final_winner"],
    resultShapes: ["home_away_winner", "three_way_result"],
    supportsSource: () => true,
    capabilities: {
      closeCondition: true,
      resolution: true
    },
    inspectCloseCondition: async () => ({
      objectType: "oracle_source_inspection",
      sourceFamily: "test_family",
      sourceUrl: "https://example.invalid/match/1",
      status: "live",
      closeConditionSatisfied: true,
      resolutionAvailable: false,
      fetchedAt: "2026-05-09T16:01:00.000Z",
      rawHash: "hash",
      normalizedSnapshot: {
        state: "live"
      },
      claimSummary: "Match is live.",
      confidence: "high",
      blockers: []
    }),
    inspectResolution: async () => ({
      objectType: "oracle_source_inspection",
      sourceFamily: "test_family",
      sourceUrl: "https://example.invalid/match/1",
      status: "final",
      closeConditionSatisfied: true,
      resolutionAvailable: true,
      winnerKind: "home",
      winnerLabel: "בית",
      fetchedAt: "2026-05-09T18:01:00.000Z",
      rawHash: "hash",
      normalizedSnapshot: {
        state: "final"
      },
      claimSummary: "Home won.",
      confidence: "high",
      blockers: []
    }),
    ...overrides
  };
}

describe("oracle lifecycle source adapter registry", () => {
  it("classifies a market as close and resolution supported when one adapter owns both capabilities", () => {
    const result = classifyOracleLifecycleSupport(BASE_CONTEXT, [
      adapter({
        sourceFamily: "official_match",
        capabilities: {
          closeCondition: true,
          resolution: true
        }
      })
    ]);

    expect(result).toMatchObject({
      objectType: "oracle_lifecycle_capability",
      marketId: "disc-cm-proof",
      classification: "supported_close_and_resolution",
      close: {
        supported: true,
        sourceFamily: "official_match"
      },
      resolution: {
        supported: true,
        sourceFamily: "official_match"
      },
      blockers: []
    });
  });

  it("blocks a registered adapter when required credentials are missing", () => {
    delete process.env.MISSING_TEST_SOURCE_TOKEN;

    const result = classifyOracleLifecycleSupport(BASE_CONTEXT, [
      adapter({
        sourceFamily: "credentialed_match",
        requiredEnvVars: ["MISSING_TEST_SOURCE_TOKEN"],
        capabilities: {
          closeCondition: false,
          resolution: true
        }
      })
    ]);

    expect(result).toMatchObject({
      classification: "registered_no_credentials",
      close: {
        supported: false
      },
      resolution: {
        supported: false,
        sourceFamily: "credentialed_match"
      },
      blockers: [
        {
          blockerCode: "registered_no_credentials",
          reason: expect.stringContaining("MISSING_TEST_SOURCE_TOKEN")
        }
      ]
    });
  });

  it("treats unsupported official sources as an explicit blocker, not completed-clean silence", () => {
    const result = classifyOracleLifecycleSupport(BASE_CONTEXT, []);

    expect(result).toMatchObject({
      classification: "unsupported_source_family",
      close: {
        supported: false
      },
      resolution: {
        supported: false
      },
      blockers: [
        {
          blockerCode: "unsupported_source_family"
        }
      ]
    });
  });

  it("classifies missing resolution source as contract incomplete", () => {
    const result = classifyOracleLifecycleSupport(
      {
        ...BASE_CONTEXT,
        resolutionSource: ""
      },
      [
        adapter({
          sourceFamily: "official_match"
        })
      ]
    );

    expect(result).toMatchObject({
      classification: "contract_incomplete",
      blockers: [
        {
          blockerCode: "contract_incomplete"
        }
      ]
    });
  });

  it("recognizes NBA, Niké Liga, FIFA, IFA, and Winner League official match URLs without market-specific wiring", () => {
    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://www.nba.com/game/tor-vs-cle-0042500137"
      })?.sourceFamily
    ).toBe("nba_official_game");

    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://www.nikeliga.sk/zapas/2772-pod-slo"
      })?.sourceFamily
    ).toBe("nike_liga_match_page");

    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://www.fifa.com/en/match-centre/match/10005/289175/289176/400019164",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "final_winner",
          resultShape: "three_way_result",
          oracleCapability: "supported_full_cycle",
          resolutionSource: {
            url: "https://www.fifa.com/en/match-centre/match/10005/289175/289176/400019164",
            sourceIds: ["src_fifa_match_centre"]
          }
        }
      })?.sourceFamily
    ).toBe("fifa_match_centre");

    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://www.football.org.il/national-cup/?national_cup_id=618&season_id=27",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "final_winner",
          resultShape: "three_way_result",
          oracleCapability: "supported_final_only",
          resolutionSource: {
            url: "https://www.football.org.il/national-cup/?national_cup_id=618&season_id=27",
            sourceIds: ["src_ifa_fixtures_results"]
          }
        }
      })?.sourceFamily
    ).toBe("ifa_fixtures_results");

    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://basket.co.il/pbp/json/games_all.json#game-26515"
      })?.sourceFamily
    ).toBe("winner_league_basketball");

    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "deadline_yes_no",
          resultShape: "yes_no",
          oracleCapability: "supported_full_cycle",
          resolutionSource: {
            url: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907",
            sourceIds: ["src_knesset_official"]
          }
        }
      })?.sourceFamily
    ).toBe("knesset_official_legislation");

    expect(
      findOracleLifecycleSourceAdapter({
        ...BASE_CONTEXT,
        resolutionSource: "https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          machineResolutionEndpoint: "https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false",
          resolutionSource: {
            url: "https://www.cbs.gov.il/en/Pages/Main%20Price%20Indices.aspx",
            sourceIds: ["src_cbs_time_series"]
          }
        }
      })?.sourceFamily
    ).toBe("cbs_time_series");
  });

  it("recognizes Coinbase Exchange candle contracts as final-resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      closeOnEventCompletion: false,
      resolutionSource: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "threshold_crossing",
        resultShape: "yes_no",
        oracleCapability: "supported_final_only",
        resolutionSource: {
          url: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400",
          sourceIds: ["src_coinbase_exchange_candles"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_resolution_only",
      close: {
        supported: false
      },
      resolution: {
        supported: true,
        sourceFamily: "coinbase_exchange_candles"
      },
      blockers: []
    });
  });

  it("maps Coinbase range buckets from contract resolution paths when labels are terse", async () => {
    const inspection = await COINBASE_CANDLES_SOURCE_ADAPTER.inspectResolution(
      {
        ...BASE_CONTEXT,
        closeOnEventCompletion: false,
        marketTitle: "Multi Graph Check",
        resolutionSource: "Coinbase Advanced Trade ETH-USD: https://www.coinbase.com/advanced-trade/spot/ETH-USD",
        resolutionRules:
          "Graph-check market. הכרעה לפי נר הסגירה היומי של ETH-USD ב-Coinbase Exchange עבור 26 במאי 2026 (UTC).",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "official_value",
          resultShape: "multi_outcome",
          oracleCapability: "supported_final_only",
          resolutionSource: {
            url: "https://www.coinbase.com/advanced-trade/spot/ETH-USD",
            sourceIds: ["src_coinbase_exchange_candles"]
          },
          outcomeMap: [
            {
              outcomeLabel: "Low",
              evidenceKey: "below-2080",
              resolutionPath: "זוכה אם מחיר הסגירה נמוך מ-2,080 דולר."
            },
            {
              outcomeLabel: "Middle",
              evidenceKey: "range-2080-2140",
              resolutionPath: "זוכה אם מחיר הסגירה הוא בין 2,080 ל-2,140 דולר, כולל הגבולות."
            },
            {
              outcomeLabel: "High",
              evidenceKey: "above-2140",
              resolutionPath: "זוכה אם מחיר הסגירה גבוה מ-2,140 דולר."
            }
          ]
        },
        outcomes: [
          { outcomeId: "low", outcomeKey: "below-2080", label: "Low" },
          { outcomeId: "middle", outcomeKey: "range-2080-2140", label: "Middle" },
          { outcomeId: "high", outcomeKey: "above-2140", label: "High" }
        ]
      },
      {
        fetchJson: async () => [[1779753600, 2052, 2138.55, 2111.04, 2070.88, 100]],
        now: new Date("2026-05-27T08:00:00.000Z")
      }
    );

    expect(inspection).toMatchObject({
      status: "final",
      resolutionAvailable: true,
      evidenceKey: "below-2080",
      winnerLabel: "Low",
      blockers: []
    });
  });

  it("recognizes IFA final-result contracts as final-resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      closeOnEventCompletion: false,
      resolutionSource: "https://www.football.org.il/national-cup/?national_cup_id=618&season_id=27",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_winner",
        resultShape: "three_way_result",
        oracleCapability: "supported_final_only",
        resolutionSource: {
          url: "https://www.football.org.il/national-cup/?national_cup_id=618&season_id=27",
          sourceIds: ["src_ifa_fixtures_results"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_resolution_only",
      close: {
        supported: false
      },
      resolution: {
        supported: true,
        sourceFamily: "ifa_fixtures_results"
      },
      blockers: []
    });
  });

  it("recognizes FIFA Match Centre contracts as full-cycle supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      resolutionSource: "https://www.fifa.com/en/match-centre/match/10005/289175/289176/400019164",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_winner",
        resultShape: "three_way_result",
        oracleCapability: "supported_full_cycle",
        resolutionSource: {
          url: "https://www.fifa.com/en/match-centre/match/10005/289175/289176/400019164",
          sourceIds: ["src_fifa_match_centre"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_close_and_resolution",
      close: {
        supported: true,
        sourceFamily: "fifa_match_centre"
      },
      resolution: {
        supported: true,
        sourceFamily: "fifa_match_centre"
      },
      blockers: []
    });
  });

  it("recognizes BOI representative exchange-rate contracts as final-resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      closeOnEventCompletion: false,
      resolutionSource: "https://boi.org.il/PublicApi/GetExchangeRates",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "threshold_crossing",
        resultShape: "yes_no",
        oracleCapability: "supported_final_only",
        resolutionSource: {
          url: "https://boi.org.il/PublicApi/GetExchangeRates",
          sourceIds: ["src_boi_exchange_rates"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_resolution_only",
      close: {
        supported: false
      },
      resolution: {
        supported: true,
        sourceFamily: "boi_exchange_rates"
      },
      blockers: []
    });
  });

  it("recognizes TradingView live-FX contracts as final-resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      closeOnEventCompletion: false,
      resolutionSource: "https://www.tradingview.com/symbols/EURUSD/",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "threshold_crossing",
        resultShape: "yes_no",
        oracleCapability: "supported_final_only",
        trustDisplayUrl: "https://www.tradingview.com/symbols/EURUSD/",
        machineResolutionEndpoint: "https://example.test/tradingview/fx?symbol=EURUSD&at=2026-06-02T20:59:00Z",
        resolutionSource: {
          url: "https://www.tradingview.com/symbols/EURUSD/",
          sourceIds: ["src_tradingview_fx"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_resolution_only",
      close: {
        supported: false
      },
      resolution: {
        supported: true,
        sourceFamily: "tradingview_fx"
      },
      blockers: []
    });
  });

  it("recognizes Eurovision official scoreboard contracts as final-resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      closeOnEventCompletion: false,
      resolutionSource: "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_winner",
        resultShape: "yes_no",
        oracleCapability: "supported_final_only",
        resolutionSource: {
          url: "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
          sourceIds: ["src_eurovision_official"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_resolution_only",
      close: {
        supported: false
      },
      resolution: {
        supported: true,
        sourceFamily: "eurovision_official_scoreboard"
      },
      blockers: []
    });
  });

  it("recognizes Eurovision official multi-outcome scoreboard contracts as final-resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      closeOnEventCompletion: false,
      resolutionSource: "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "official_value",
        resultShape: "multi_outcome",
        oracleCapability: "supported_final_only",
        resolutionSource: {
          url: "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/",
          sourceIds: ["src_eurovision_official"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_resolution_only",
      resolution: {
        supported: true,
        sourceFamily: "eurovision_official_scoreboard"
      },
      blockers: []
    });
  });

  it("uses Seer contract stamp to route supported source families before URL heuristics", () => {
    const result = classifyOracleLifecycleSupport(
      {
        ...BASE_CONTEXT,
        resolutionSource: "https://www.nba.com/game/tor-vs-cle-0042500137",
        marketContract: {
          objectType: "market_contract_v1",
          measurementKind: "final_winner",
          resultShape: "home_away_winner",
          oracleCapability: "supported_full_cycle",
          resolutionSource: {
            url: "https://www.nba.com/game/tor-vs-cle-0042500137",
            sourceIds: ["src_nba_official_games"]
          }
        }
      }
    );

    expect(result).toMatchObject({
      classification: "supported_close_and_resolution",
      close: {
        sourceFamily: "nba_official_game"
      },
      resolution: {
        sourceFamily: "nba_official_game"
      },
      blockers: []
    });
  });

  it("classifies Winner League basketball contracts as full-cycle supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      resolutionSource: "https://basket.co.il/pbp/json/games_all.json#game-26515",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_winner",
        resultShape: "home_away_winner",
        oracleCapability: "supported_full_cycle",
        resolutionSource: {
          url: "https://basket.co.il/pbp/json/games_all.json#game-26515",
          sourceIds: ["src_winner_league_basketball"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_close_and_resolution",
      close: {
        sourceFamily: "winner_league_basketball"
      },
      resolution: {
        sourceFamily: "winner_league_basketball"
      },
      blockers: []
    });
  });

  it("classifies IBBA basketball contracts as full-cycle supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      resolutionSource: "https://ibasketball.co.il/match/778780/",
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "final_winner",
        resultShape: "home_away_winner",
        oracleCapability: "supported_full_cycle",
        resolutionSource: {
          url: "https://ibasketball.co.il/match/778780/",
          sourceIds: ["src_ibba_schedules"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_close_and_resolution",
      close: {
        sourceFamily: "ibba_schedules"
      },
      resolution: {
        sourceFamily: "ibba_schedules"
      },
      blockers: []
    });
  });

  it("classifies credible-reporting contracts as human-gated resolution supported", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "reported_claim",
        resultShape: "yes_no",
        oracleCapability: "credible_reporting",
        resolutionAuthorityType: "credible-reporting",
        resolutionSource: {
          url: "internal://oracle/credible-reporting",
          sourceIds: ["src_credible_reporting_bundle"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "supported_credible_reporting",
      close: {
        supported: false
      },
      resolution: {
        supported: true,
        sourceFamily: "credible_reporting"
      },
      blockers: []
    });
  });

  it("treats Seer blocked capability as an explicit lifecycle blocker", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "rate_direction",
        resultShape: "cut_hold_hike",
        oracleCapability: "blocked",
        resolutionSource: {
          url: "https://www.ecb.europa.eu/press/calendars/mgcgc/html/index.en.html",
          sourceIds: ["src_ecb_rss"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "blocked_by_contract",
      blockers: [
        {
          blockerCode: "blocked_by_contract"
        }
      ]
    });
  });

  it("routes manual-resolution contracts to explicit manual lifecycle handling", () => {
    const result = classifyOracleLifecycleSupport({
      ...BASE_CONTEXT,
      marketContract: {
        objectType: "market_contract_v1",
        measurementKind: "rate_direction",
        resultShape: "cut_hold_hike",
        oracleCapability: "manual_resolution_required",
        resolutionSource: {
          url: "https://www.boi.org.il/roles/monetary-policy/interest-rate-dates/",
          sourceIds: ["src_boi_announcements"]
        }
      }
    });

    expect(result).toMatchObject({
      classification: "manual_resolution_required",
      blockers: [
        {
          blockerCode: "manual_resolution_required"
        }
      ]
    });
  });
});
