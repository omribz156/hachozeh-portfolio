import { afterEach, describe, expect, it } from "vitest";

import { checkOracleSourceCapability } from "../../../../oracle/src/source-capability-service";

describe("Oracle source capability service", () => {
  const originalImsToken = process.env.IMS_API_TOKEN;

  afterEach(() => {
    if (originalImsToken == null) {
      delete process.env.IMS_API_TOKEN;
    } else {
      process.env.IMS_API_TOKEN = originalImsToken;
    }
  });

  it("answers full-cycle support for a known NBA source family", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_nba_official_games",
        measurementKind: "final_winner",
        resultShape: "home_away_winner"
      })
    ).toMatchObject({
      objectType: "oracle_source_capability_check",
      sourceId: "src_nba_official_games",
      status: "full_cycle_supported",
      adapterFamily: "nba_official_game"
    });
  });

  it("answers full-cycle support for Winner League basketball", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_winner_league_basketball",
        measurementKind: "final_winner",
        resultShape: "home_away_winner",
        sourceUrl: "https://basket.co.il/pbp/json/games_all.json#game-26515"
      })
    ).toMatchObject({
      objectType: "oracle_source_capability_check",
      sourceId: "src_winner_league_basketball",
      status: "full_cycle_supported",
      adapterFamily: "winner_league_basketball"
    });
  });

  it("answers final-only support for Bank of Israel rate decisions", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_boi_announcements",
        measurementKind: "rate_direction",
        resultShape: "cut_hold_hike"
      })
    ).toMatchObject({
      status: "final_only_supported",
      adapterFamily: "boi_rate_decision"
    });
  });

  it("answers final-only support for binary Bank of Israel unchanged-rate decisions", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_boi_announcements",
        measurementKind: "rate_direction",
        resultShape: "yes_no"
      })
    ).toMatchObject({
      status: "final_only_supported",
      adapterFamily: "boi_rate_decision"
    });
  });

  it("answers final-only support for Eurovision official scoreboard markets", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_eurovision_official",
        measurementKind: "final_winner",
        resultShape: "yes_no",
        sourceUrl: "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/"
      })
    ).toMatchObject({
      status: "final_only_supported",
      adapterFamily: "eurovision_official_scoreboard"
    });
  });

  it("answers final-only support for Eurovision all-country scoreboard markets", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_eurovision_official",
        measurementKind: "official_value",
        resultShape: "multi_outcome",
        sourceUrl: "https://www.eurovision.com/eurovision-song-contest/vienna-2026/vienna-2026-grand-final/"
      })
    ).toMatchObject({
      status: "final_only_supported",
      adapterFamily: "eurovision_official_scoreboard"
    });
  });

  it("answers full-cycle support for Knesset official legislation deadline markets", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_knesset_official",
        measurementKind: "deadline_yes_no",
        resultShape: "yes_no",
        sourceUrl: "https://main.knesset.gov.il/apps/legislation/main/bills/2198907"
      })
    ).toMatchObject({
      status: "full_cycle_supported",
      adapterFamily: "knesset_official_legislation"
    });
  });

  it("answers final-only support for CBS time-series CPI markets", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_cbs_time_series",
        measurementKind: "official_value",
        resultShape: "multi_outcome",
        sourceUrl: "https://api.cbs.gov.il/index/data/price_selected?format=xml&download=false"
      })
    ).toMatchObject({
      status: "final_only_supported",
      adapterFamily: "cbs_time_series"
    });
  });

  it("answers human-gated credible-reporting support for reported claims", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_credible_reporting_bundle",
        measurementKind: "reported_claim",
        resultShape: "yes_no"
      })
    ).toMatchObject({
      status: "credible_reporting_supported",
      adapterFamily: "credible_reporting",
      nextAction: "none"
    });
  });

  it("answers credential-needed for the registered IMS weather source family without token", () => {
    delete process.env.IMS_API_TOKEN;

    expect(
      checkOracleSourceCapability({
        sourceId: "src_ims_daily_observations",
        measurementKind: "threshold_crossing",
        resultShape: "yes_no"
      })
    ).toMatchObject({
      status: "registered_no_credentials",
      adapterFamily: "ims_daily_observations",
      nextAction: "configure_credentials"
    });
  });

  it("answers final-only support for IMS weather when token is configured", () => {
    process.env.IMS_API_TOKEN = "test-token";

    expect(
      checkOracleSourceCapability({
        sourceId: "src_ims_daily_observations",
        measurementKind: "threshold_crossing",
        resultShape: "yes_no"
      })
    ).toMatchObject({
      status: "final_only_supported",
      adapterFamily: "ims_daily_observations",
      nextAction: "none"
    });
  });

  it("does not infer unsupported route combinations from adapter measurement/result lists", () => {
    expect(
      checkOracleSourceCapability({
        sourceId: "src_coinbase_exchange_candles",
        measurementKind: "official_value",
        resultShape: "yes_no",
        sourceUrl: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=86400"
      })
    ).toMatchObject({
      status: "adapter_not_implemented",
      adapterFamily: null,
      nextAction: "build_oracle_adapter"
    });
  });
});
