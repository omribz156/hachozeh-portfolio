import { describe, expect, it } from "vitest";

import { runSeerHeartbeat } from "../../../seer/src/heartbeat";

const trendingFixture = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<rss xmlns:ht="https://trends.google.com/trending/rss" version="2.0">
  <channel>
    <item>
      <title>Eurovision 2026</title>
      <ht:approx_traffic>500+</ht:approx_traffic>
      <pubDate>Wed, 8 Apr 2026 02:20:00 -0700</pubDate>
      <ht:news_item>
        <ht:news_item_title>Story</ht:news_item_title>
        <ht:news_item_url>https://example.com/story-1</ht:news_item_url>
        <ht:news_item_source>ynet</ht:news_item_source>
      </ht:news_item>
    </item>
  </channel>
</rss>`;

const ibbaFixture = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>מתווה חזרת המשחקים במחלקות הנוער</title>
      <link>https://ibasketball.co.il/news/2026/04/return-of-youth-games/</link>
      <description>חזרת המשחקים תתקיים החל מיום חמישי הקרוב (16 באפריל).</description>
      <pubDate>Mon, 13 Apr 2026 10:06:36 GMT</pubDate>
      <guid>https://ibasketball.co.il/?p=1393231</guid>
    </item>
  </channel>
</rss>`;

const winnerLeagueConfigFixture = `[{"cYear":2026,"BigYear":"2025-26","display":"ByRound","ActiveComp":5,"nextRound":18,"comp_cat":1,"external_id":187,"round_desc":"מחזור 18","title":"ליגת Winner סל, מחזור 18","title_eng":"Winner League, Round 18"}]`;

const winnerLeagueGamesFixture = `[{"games":[
  {
    "id":26511,
    "ExternalID":"168",
    "game_type":5,
    "GN":18,
    "team_name_1":"הפועל י&quot;ם",
    "team_name_2":"בני הרצליה",
    "team_name_eng_1":"Hapoel Jerusalem",
    "team_name_eng_2":"Bnei Herzliya",
    "game_date_txt":"18/04/2026",
    "game_time":"20:20",
    "liveChannel":"5SPORT",
    "pbp_link":"https://stats.segevstats.com/realtimestat_heb/gameStats.php?game_id=168&lang=he",
    "isATC":0,
    "isLive":1,
    "score_team1":0,
    "score_team2":0
  }
]}]`;

const boiScheduleFixture = `
<h2 style="text-align: center;" class="introOutroTitle">2026 Interest rate announcement dates</h2>
<table border="0" class="table table-bordered table-striped">
<tbody>
<tr>
<td><p><strong>Press conference</strong></p></td>
<td><p><strong>Research Department Staff Forecast</strong></p></td>
<td><p><strong>Maintenance period Start Date</strong></p></td>
<td><p><strong>Start Date</strong></p></td>
<td><p><strong>Publication Date</strong></p></td>
</tr>
<tr>
<td><p>30/03/2026</p></td>
<td><p>30/03/2026</p></td>
<td><p>26/03/2026</p></td>
<td><p>03/04/2026</p></td>
<td><p>30/03/2026</p></td>
</tr>
<tr>
<td><p>&nbsp;</p></td>
<td><p>&nbsp;</p></td>
<td><p>28/05/2026</p></td>
<td><p>28/05/2026</p></td>
<td><p>25/05/2026</p></td>
</tr>
</tbody>
</table>`;

describe("runSeerHeartbeat", () => {
  it("aggregates multi-source fetchers into one heartbeat result", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("trends.google.com")) {
        return new Response(trendingFixture, {
          status: 200
        });
      }

      if (url.includes("ibasketball.co.il")) {
        return new Response(ibbaFixture, {
          status: 200
        });
      }

      if (url.includes("basket.co.il/pbp/json/config.json")) {
        return new Response(winnerLeagueConfigFixture, {
          status: 200
        });
      }

      if (url.includes("basket.co.il/pbp/json/games_all.json")) {
        return new Response(winnerLeagueGamesFixture, {
          status: 200
        });
      }

      if (url.includes("interest-rate-announcement-dates")) {
        return new Response(boiScheduleFixture, {
          status: 200
        });
      }

      return new Response("not found", {
        status: 404
      });
    };

    const result = await runSeerHeartbeat("2026-04-08T10:00:00.000Z", [], mockFetch);

    expect(result.fetchedCount).toBe(4);
    expect(result.importedCount).toBe(4);
    expect(result.sourceRuns.map((run) => run.status)).toEqual([
      "ok",
      "ok",
      "ok",
      "ok"
    ]);
    expect(result.importedSignals.map((signal) => signal.sourceId)).toEqual([
      "src_google_trending_il",
      "src_ibba_schedules",
      "src_winner_league_basketball",
      "src_boi_announcements"
    ]);
  });
});
