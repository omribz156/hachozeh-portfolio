import { describe, expect, it } from "vitest";

import {
  fetchBankOfIsraelSignals,
  fetchEcbSignals,
  fetchFederalReserveSignals,
  fetchGdacsSignals,
  fetchIbbaSignals,
  fetchWinnerLeagueSignals,
  parseBankOfIsraelRateAnnouncementDatesHtml,
  fetchUsgsSignals,
  parseBankOfIsraelPressReleasesHtml,
  parseGdacsRss,
  parseUsgsEarthquakes
} from "../../../seer/src/general-source-fetchers";

const fedFixture = `<?xml version="1.0" encoding="utf-8" ?>
<rss version="2.0">
  <channel>
    <item>
      <title>Federal Reserve issues FOMC statement</title>
      <link><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260410a.htm]]></link>
      <guid><![CDATA[https://www.federalreserve.gov/newsevents/pressreleases/monetary20260410a.htm]]></guid>
      <description><![CDATA[Federal Reserve issues FOMC statement]]></description>
      <category>Monetary Policy</category>
      <pubDate><![CDATA[Fri, 10 Apr 2026 18:00:00 GMT]]></pubDate>
    </item>
  </channel>
</rss>`;

const ecbFixture = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title> ECB announces policy decision </title>
      <link>https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260410.en.html</link>
      <guid>https://www.ecb.europa.eu/press/pr/date/2026/html/ecb.pr260410.en.html</guid>
      <pubDate>Fri, 10 Apr 2026 10:00:00 +0200</pubDate>
    </item>
  </channel>
</rss>`;

const boiFixture = `
<section class="PressReleases bg-ffffff p-lg-3" id="itemsContainer">
  <div class="items" id="items">
    <a href="/en/communication-and-publications/press-releases/the-monetary-committee-decides-on-march-30-2026-to-leave-the-interest-rate-unchanged-at-400-percent/" title="The Monetary Committee decides on March 30, 2026 to leave the interest rate unchanged at 4.00 percent.">
      <div class="publicationBlock pressReleasesBlock">
        <div class="d-flex">
          <div class="dataCol">
            <div class="d-flex flex-column flex-lg-row align-items-lg-center ps-5 ps-lg-0">
              <div class="date">30/03/2026</div>
              <div class="subjects ps-lg-3">
                <ul class="list-unstyled auctionSubjects list-group list-group-horizontal">
                  <li>Interest Rate Announcements</li>
                </ul>
              </div>
            </div>
            <div class="spoiler ps-5 ps-lg-0">
              The Monetary Committee decides on March 30, 2026 to leave the interest rate unchanged at 4.00 percent.
            </div>
          </div>
        </div>
      </div>
    </a>
    <a href="/en/communication-and-publications/press-releases/research-department-staff-forecast-march-2026/" title="Research Department Staff Forecast, March 2026">
      <div class="publicationBlock pressReleasesBlock">
        <div class="d-flex">
          <div class="dataCol">
            <div class="d-flex flex-column flex-lg-row align-items-lg-center ps-5 ps-lg-0">
              <div class="date">30/03/2026</div>
            </div>
            <div class="spoiler ps-5 ps-lg-0">
              Research Department Staff Forecast, March 2026
            </div>
          </div>
        </div>
      </div>
    </a>
  </div>
</section>`;

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
<tr>
<td><p>06/07/2026</p></td>
<td><p>06/07/2026</p></td>
<td><p>09/07/2026</p></td>
<td><p>09/07/2026</p></td>
<td><p>06/07/2026</p></td>
</tr>
<tr>
<td><p>24/08/2026</p></td>
<td><p>24/08/2026</p></td>
<td><p>27/08/2026</p></td>
<td><p>27/08/2026</p></td>
<td><p>24/08/2026</p></td>
</tr>
</tbody>
</table>`;

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
    <item>
      <title>אילת רחוקה ניצחון מעליית ליגה</title>
      <link>https://ibasketball.co.il/news/2026/04/eilat-win/</link>
      <description>אילת ניצחה 96:89 ברמה"ש.</description>
      <pubDate>Fri, 10 Apr 2026 19:54:15 GMT</pubDate>
      <guid>https://ibasketball.co.il/?p=1392117</guid>
    </item>
    <item>
      <title>ירדן גרזון השתתפה במשחק האולסטאר במכללות</title>
      <link>https://ibasketball.co.il/news/2026/04/yarden-garzon-all-star/</link>
      <description>הישראלית נבחרה לאחת מ-20 השחקניות שלקחו חלק במשחק האולסטאר.</description>
      <pubDate>Fri, 10 Apr 2026 12:00:00 GMT</pubDate>
      <guid>https://ibasketball.co.il/?p=1392001</guid>
    </item>
    <item>
      <title>נבחרת ישראל נשים שובצה לבית ט' במוקדמות אליפות אירופה 2027</title>
      <link>https://ibasketball.co.il/news/2026/03/women-euro-2027-draw/</link>
      <description>ההגרלה תתקיים ב-31 במרץ בשעה 15:00 ושתי הראשונות מכל בית תעפלנה.</description>
      <pubDate>Sun, 12 Apr 2026 09:30:00 GMT</pubDate>
      <guid>https://ibasketball.co.il/?p=1391001</guid>
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
  },
  {
    "id":26509,
    "ExternalID":"165",
    "game_type":5,
    "GN":18,
    "team_name_1":"הפועל ב&quot;ש",
    "team_name_2":"הפועל חולון",
    "team_name_eng_1":"Beer Sheva/Dimona",
    "team_name_eng_2":"Hapoel Holon",
    "game_date_txt":"19/04/2026",
    "game_time":"20:30",
    "liveChannel":"5PLUS",
    "pbp_link":"https://stats.segevstats.com/realtimestat_heb/gameStats.php?game_id=165&lang=he",
    "isATC":0,
    "isLive":1,
    "score_team1":0,
    "score_team2":0
  },
  {
    "id":26514,
    "ExternalID":"169",
    "game_type":5,
    "GN":19,
    "team_name_1":"מכבי רמת גן",
    "team_name_2":"אליצור נתניה",
    "team_name_eng_1":"Maccabi Ramat Gan",
    "team_name_eng_2":"Elitzur Netanya",
    "game_date_txt":"23/04/2026",
    "game_time":"",
    "liveChannel":"שידור טרם נקבע",
    "pbp_link":"",
    "isATC":1,
    "isLive":1,
    "score_team1":0,
    "score_team2":0
  },
  {
    "id":26518,
    "ExternalID":"173",
    "game_type":5,
    "GN":20,
    "team_name_1":"מכבי תל אביב",
    "team_name_2":"הפועל תל אביב",
    "team_name_eng_1":"Maccabi Tel Aviv",
    "team_name_eng_2":"Hapoel Tel Aviv",
    "game_date_txt":"29/04/2026",
    "game_time":"21:00",
    "liveChannel":"5SPORT",
    "pbp_link":"https://stats.segevstats.com/realtimestat_heb/gameStats.php?game_id=173&lang=he",
    "isATC":0,
    "isLive":1,
    "score_team1":0,
    "score_team2":0
  }
]}]`;

const gdacsFixture = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:gdacs="http://www.gdacs.org">
  <channel>
    <item>
      <title>Orange earthquake alert in Japan</title>
      <description>On 12/04/2026, an earthquake occurred in Japan.</description>
      <link>https://www.gdacs.org/report.aspx?eventtype=EQ&amp;eventid=1001</link>
      <pubDate>Sun, 12 Apr 2026 11:00:09 GMT</pubDate>
      <guid isPermaLink="false">EQ1001</guid>
      <gdacs:eventtype>EQ</gdacs:eventtype>
      <gdacs:alertlevel>Orange</gdacs:alertlevel>
      <gdacs:country>Japan</gdacs:country>
    </item>
    <item>
      <title>Green forest fire notification in Australia</title>
      <description>On 12/04/2026, a forest fire started in Australia.</description>
      <link>https://www.gdacs.org/report.aspx?eventtype=WF&amp;eventid=1002</link>
      <pubDate>Sun, 12 Apr 2026 10:00:09 GMT</pubDate>
      <guid isPermaLink="false">WF1002</guid>
      <gdacs:eventtype>WF</gdacs:eventtype>
      <gdacs:alertlevel>Green</gdacs:alertlevel>
      <gdacs:country>Australia</gdacs:country>
    </item>
  </channel>
</rss>`;

const usgsFixture = JSON.stringify({
  features: [
    {
      id: "us7000test",
      properties: {
        title: "M 7.1 - near the east coast of Honshu, Japan",
        mag: 7.1,
        place: "near the east coast of Honshu, Japan",
        time: Date.parse("2026-04-12T10:30:00Z"),
        url: "https://earthquake.usgs.gov/earthquakes/eventpage/us7000test",
        alert: "orange",
        tsunami: 1,
        status: "reviewed"
      }
    }
  ]
});

describe("general source fetchers", () => {
  it("parses GDACS RSS items", () => {
    const items = parseGdacsRss(gdacsFixture);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title: "Orange earthquake alert in Japan",
      alertLevel: "Orange",
      eventType: "EQ",
      country: "Japan"
    });
  });

  it("parses USGS earthquake features", () => {
    const items = parseUsgsEarthquakes(usgsFixture);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      id: "us7000test",
      title: "M 7.1 - near the east coast of Honshu, Japan",
      alertLevel: "orange"
    });
  });

  it("fetches recent Fed and ECB signals", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("federalreserve.gov")) {
        return new Response(fedFixture, { status: 200 });
      }

      if (url.includes("ecb.europa.eu")) {
        return new Response(ecbFixture, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const fedSignals = await fetchFederalReserveSignals("2026-04-12T12:00:00.000Z", mockFetch);
    const ecbSignals = await fetchEcbSignals("2026-04-12T12:00:00.000Z", mockFetch);

    expect(fedSignals[0]).toMatchObject({
      sourceId: "src_federal_reserve_rss",
      category: "economy"
    });
    expect(ecbSignals[0]).toMatchObject({
      sourceId: "src_ecb_rss",
      category: "economy"
    });
  });

  it("parses Bank of Israel press releases but suppresses already-resolved rate decisions", async () => {
    const items = parseBankOfIsraelPressReleasesHtml(boiFixture);

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      title:
        "The Monetary Committee decides on March 30, 2026 to leave the interest rate unchanged at 4.00 percent.",
      subjects: ["Interest Rate Announcements"]
    });

    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("boi.org.il")) {
        return new Response(boiFixture, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const boiSignals = await fetchBankOfIsraelSignals("2026-04-12T12:00:00.000Z", mockFetch);

    expect(boiSignals).toHaveLength(0);
  });

  it("parses official BOI schedule pages and extracts future publication dates", () => {
    const items = parseBankOfIsraelRateAnnouncementDatesHtml(boiScheduleFixture);

    expect(items).toEqual([
      {
        publicationDateIso: "2026-03-30T00:00:00.000Z",
        publicationDateLabel: "March 30, 2026",
        sourceRef:
          "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/"
      },
      {
        publicationDateIso: "2026-05-25T00:00:00.000Z",
        publicationDateLabel: "May 25, 2026",
        sourceRef:
          "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/"
      },
      {
        publicationDateIso: "2026-07-06T00:00:00.000Z",
        publicationDateLabel: "July 6, 2026",
        sourceRef:
          "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/"
      },
      {
        publicationDateIso: "2026-08-24T00:00:00.000Z",
        publicationDateLabel: "August 24, 2026",
        sourceRef:
          "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/"
      }
    ]);
  });

  it("keeps forward-looking BOI rate-decision schedule notices for planned intake", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("interest-rate-announcement-dates")) {
        return new Response(boiScheduleFixture, { status: 200 });
      }

      if (url.includes("boi.org.il")) {
        return new Response(boiFixture, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const boiSignals = await fetchBankOfIsraelSignals("2026-04-12T12:00:00.000Z", mockFetch);

    expect(boiSignals).toHaveLength(3);
    expect(boiSignals[0]).toMatchObject({
      sourceId: "src_boi_announcements",
      category: "economy",
      sourceLabel: "בנק ישראל",
      recurringTemplateId: "boi-rate-decision-v1",
      tags: expect.arrayContaining(["planned"]),
      question: "החלטת בנק ישראל במאי?",
      suggestedCloseShape: "Close before May 25, 2026 at 16:00."
    });
    expect(boiSignals[0].proposedOutcomes?.map((outcome) => outcome.label)).toEqual([
      "ירידה של 0.50%+",
      "ירידה של 0.25%",
      "ללא שינוי",
      "עלייה של 0.25%",
      "עלייה של 0.50%+"
    ]);
    expect(boiSignals[0].notes).toEqual(
      expect.arrayContaining([
        "grounding: event-date=May 25, 2026",
        "grounding: publication-time=16:00",
        "grounding: source=boi-rate-announcement-dates"
      ])
    );
    expect(boiSignals[1]).toMatchObject({
      observedAt: "2026-07-06T00:00:00.000Z",
      question: "החלטת בנק ישראל ביולי?",
      suggestedCloseShape: "Close before July 6, 2026 at 16:00."
    });
    expect(boiSignals[2]).toMatchObject({
      observedAt: "2026-08-24T00:00:00.000Z",
      question: "החלטת בנק ישראל באוגוסט?",
      suggestedCloseShape: "Close before August 24, 2026 at 16:00."
    });
  });

  it("keeps next-round Winner League fixtures as already-shaped planned sports markets", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("pbp/json/config.json")) {
        return new Response(winnerLeagueConfigFixture, { status: 200 });
      }

      if (url.includes("pbp/json/games_all.json")) {
        return new Response(winnerLeagueGamesFixture, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const signals = await fetchWinnerLeagueSignals("2026-04-16T12:00:00.000Z", mockFetch);

    expect(signals).toHaveLength(3);
    expect(signals[0]).toMatchObject({
      sourceId: "src_winner_league_basketball",
      intakeLane: "planned",
      recurringTemplateId: "sports-match-winner-v1",
      category: "sports",
      question: `הפועל י"ם vs בני הרצליה (ליגת Winner סל, 18 באפריל)`,
      suggestedCloseShape: "Close before April 18, 2026 at 20:20.",
      suggestedResolutionAnchor: "תוצאת המשחק הרשמית של מנהלת ליגת Winner סל.",
      sourceRef: "https://basket.co.il/game-zone.asp?GameId=26511#!stats"
    });
    expect(signals[0]?.notes).toEqual(
      expect.arrayContaining([
        "grounding: competition=ליגת Winner סל",
        "grounding: event-date=April 18, 2026",
        "grounding: event-time=20:20",
        "machine-source=https://basket.co.il/pbp/json/games_all.json#game-26511",
        "grounding: round=18",
        "intake-lane=planned"
      ])
    );
    expect(signals[1]?.question).toContain("הפועל ב\"ש vs הפועל חולון");
    expect(signals[2]?.question).toContain("מכבי רמת גן vs אליצור נתניה");
  });

  it("keeps only forward-looking IBBA schedule-style notices", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("ibasketball.co.il")) {
        return new Response(ibbaFixture, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const ibbaSignals = await fetchIbbaSignals("2026-04-13T12:00:00.000Z", mockFetch);

    expect(ibbaSignals).toHaveLength(2);
    expect(ibbaSignals[0]).toMatchObject({
      sourceId: "src_ibba_schedules",
      category: "sports",
      sourceLabel: "IBBA",
      intakeLane: "planned",
      tags: expect.arrayContaining(["planned", "return-to-play"])
    });
    expect(ibbaSignals[0].title).toBe("מתווה חזרת המשחקים במחלקות הנוער");
    expect(ibbaSignals[0].notes).toEqual(
      expect.arrayContaining(["grounding: ibba-update-kind=return-to-play"])
    );
    expect(ibbaSignals[1].title).toBe("נבחרת ישראל נשים שובצה לבית ט' במוקדמות אליפות אירופה 2027");
    expect(ibbaSignals[1].tags).toEqual(expect.arrayContaining(["competition-draw"]));
    expect(ibbaSignals[1].notes).toEqual(
      expect.arrayContaining(["grounding: ibba-update-kind=competition-draw"])
    );
  });

  it("filters GDACS green noise and converts USGS earthquake alerts into manual signals", async () => {
    const mockFetch: typeof fetch = async (input) => {
      const url = String(input);

      if (url.includes("gdacs.org")) {
        return new Response(gdacsFixture, { status: 200 });
      }

      if (url.includes("earthquake.usgs.gov")) {
        return new Response(usgsFixture, { status: 200 });
      }

      return new Response("not found", { status: 404 });
    };

    const gdacsSignals = await fetchGdacsSignals("2026-04-12T12:00:00.000Z", mockFetch);
    const usgsSignals = await fetchUsgsSignals("2026-04-12T12:00:00.000Z", mockFetch);

    expect(gdacsSignals).toHaveLength(1);
    expect(gdacsSignals[0]).toMatchObject({
      sourceId: "src_gdacs_alerts",
      category: "science"
    });
    expect(usgsSignals[0]).toMatchObject({
      sourceId: "src_usgs_alerts",
      category: "science"
    });
  });
});
