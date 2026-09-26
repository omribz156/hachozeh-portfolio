import { describe, expect, it } from "vitest";

import { enrichSignal } from "../../../seer/src/signal-enrichment";

describe("signal enrichment", () => {
  it("infers sports category and follow-up-needed marketability for raw trend buzz", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "כדורסל",
      summary: 'Google Trends IL shows "כדורסל" as an active trend.',
      whyNow: '"כדורסל" is trending in Israel right now.',
      observedAt: "2026-04-09T10:00:00.000Z",
      keyEntities: ["כדורסל"],
      notes: ["ספורט 5: https://example.com/story-1"],
      tags: ["google-trending", "geo-il", "heartbeat"]
    });

    expect(enrichment.inferredCategory).toBe("sports");
    expect(enrichment.topicKind).toBe("team-or-competition-buzz");
    expect(enrichment.marketability).toBe("follow-up-needed");
  });

  it("drafts explicit sports head-to-head trends into named winner buckets", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "spurs vs trail blazers",
      summary: 'Google Trends IL shows "spurs vs trail blazers" as an active trend.',
      whyNow: '"spurs vs trail blazers" is trending in Israel right now.',
      observedAt: "2026-04-12T10:00:00.000Z",
      keyEntities: ["spurs vs trail blazers"],
      notes: [
        "Yahoo Sports: NBA matchup preview | https://sports.yahoo.com/nba/spurs-vs-trail-blazers-20260412-preview",
        "ESPN: Spurs and Trail Blazers lineups | https://www.espn.com/nba/game/_/gameId/401999999"
      ],
      tags: ["google-trending"]
    });

    expect(enrichment.inferredCategory).toBe("sports");
    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftRecurringTemplateId).toBe("sports-match-winner-v1");
    expect(enrichment.draftQuestion).toBe("Spurs vs Trail Blazers (NBA, Apr 12)");
    expect(enrichment.draftMarketForm).toBe("multi-outcome");
    expect(enrichment.draftOutcomes?.map((outcome) => outcome.label)).toEqual(["Spurs", "Trail Blazers"]);
    expect(enrichment.draftClusterHint).toContain("april_12_2026");
    expect(enrichment.draftSuggestedResolutionAnchor).toBe("Official NBA match result.");
  });

  it("keeps football matchups in follow-up-needed mode when league/date grounding is missing", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "Ajax vs Heracles",
      summary: 'Google Trends IL shows "Ajax vs Heracles" as an active trend.',
      whyNow: '"Ajax vs Heracles" is trending in Israel right now.',
      observedAt: "2026-04-12T10:00:00.000Z",
      keyEntities: ["Ajax vs Heracles"],
      tags: ["google-trending"]
    });

    expect(enrichment.inferredCategory).toBe("sports");
    expect(enrichment.marketability).toBe("follow-up-needed");
    expect(enrichment.draftQuestion).toBeUndefined();
  });

  it("uses three-way buckets for grounded football matchups", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "Barcelona vs Espanyol",
      summary: 'La Liga derby buzz is rising around "Barcelona vs Espanyol".',
      whyNow: '"Barcelona vs Espanyol" is trending with derby and La Liga attention.',
      observedAt: "2026-04-11T10:00:00.000Z",
      keyEntities: ["Barcelona vs Espanyol", "La Liga"],
      notes: [
        "Mundo Deportivo: Barca derby preview | https://www.mundodeportivo.com/futbol/fc-barcelona/2026/04/11/1004168399/posible-once-barca-derbi-retoques.html",
        "SPORT: Barca Espanyol directo | https://www.sport.es/es/noticias/barca/barca-espanyol-directo-alineaciones-horario-128986438"
      ],
      tags: ["google-trending", "la-liga", "derby"]
    });

    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftRecurringTemplateId).toBe("sports-regulation-3way-v1");
    expect(enrichment.draftQuestion).toBe("Barcelona vs Espanyol (La Liga, Apr 11)");
    expect(enrichment.draftOutcomes?.map((outcome) => outcome.label)).toEqual(["Barcelona", "Draw", "Espanyol"]);
    expect(enrichment.draftSuggestedResolutionAnchor).toBe("Official La Liga match result.");
  });

  it("collapses cross-language matchup variants onto the same canonical sports lineage", () => {
    const english = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "chelsea vs man city",
      summary: 'Google Trends IL shows "chelsea vs man city" as an active trend.',
      whyNow: '"chelsea vs man city" is trending in Israel right now.',
      observedAt: "2026-04-12T14:50:00.000Z",
      keyEntities: ["chelsea vs man city"],
      notes: [
        "Chelsea official site: Confirmed Chelsea line up vs Manchester City | News | Official Site | https://www.chelseafc.com/en/news/article/confirmed-chelsea-line-up-vs-manchester-city-april-2026",
        "BBC: Chelsea vs Manchester City: Premier League preview, team news, stats & head-to-head | https://www.bbc.com/sport/football/live/cwyxndndp4pt"
      ],
      tags: ["google-trending"]
    });
    const hebrew = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "צ'לסי נגד מנצ'סטר סיטי",
      summary: 'Google Trends IL shows "צ\'לסי נגד מנצ\'סטר סיטי" as an active trend.',
      whyNow: '"צ\'לסי נגד מנצ\'סטר סיטי" is trending in Israel right now.',
      observedAt: "2026-04-12T14:40:00.000Z",
      keyEntities: ["צ'לסי נגד מנצ'סטר סיטי"],
      notes: [
        "ספורט 1: תצמק את הפער מארסנל? שרקי בהרכב מנצ'סטר סיטי מול צ'לסי | https://sport1.maariv.co.il/world-soccer/premier-league/article/1823750/",
        "Vietnam.vn: צ'לסי בסכנה | https://www.vietnam.vn/he/chelsea-lam-nguy"
      ],
      tags: ["google-trending"]
    });

    expect(english.draftLineageHint).toBe("sports_match_chelsea_vs_manchester_city");
    expect(hebrew.draftLineageHint).toBe("sports_match_chelsea_vs_manchester_city");
    expect(hebrew.marketability).toBe("draft-ready");
    expect(hebrew.draftRecurringTemplateId).toBe("sports-regulation-3way-v1");
    expect(hebrew.draftClusterHint).toBe("sports_match_april_12_2026_chelsea_vs_manchester_city");
  });

  it("does not draft sports matchups when the inferred event date is already past", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "Trail Blazers vs Spurs",
      summary: 'NBA buzz is rising around "Trail Blazers vs Spurs".',
      whyNow: '"Trail Blazers vs Spurs" is trending with matchup coverage.',
      observedAt: "2026-04-12T10:00:00.000Z",
      keyEntities: ["Trail Blazers vs Spurs", "NBA"],
      notes: [
        "Yahoo Sports: NBA matchup preview | https://sports.yahoo.com/nba/trail-blazers-vs-spurs-20260408-preview",
        "ESPN: Trail Blazers and Spurs lineups | https://www.espn.com/nba/game/_/gameId/401999999"
      ],
      tags: ["google-trending", "nba"]
    });

    expect(enrichment.marketability).toBe("follow-up-needed");
    expect(enrichment.draftQuestion).toBeUndefined();
    expect(enrichment.inferenceNotes).toContain(
      "Draft window already passed relative to signal timing; do not propose this event."
    );
  });

  it("adds structured fetch-needed hints for sports cards that still need grounding detail", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "carlos alcaraz",
      summary: 'Google Trends IL shows "carlos alcaraz" as an active trend.',
      whyNow: '"carlos alcaraz" is trending in Israel right now.',
      observedAt: "2026-04-12T13:40:00.000Z",
      keyEntities: ["carlos alcaraz"],
      notes: [
        "MARCA: Alcaraz - Sinner en directo | Final del Montecarlo Masters 1000 hoy en vivo | https://www.marca.com/tenis/masters-1000-montecarlo/carlos-alcaraz-jannik-sinner/2026/04/12/04_0407_20260412_63-directo.html",
        "Flashscore.es: Alcaraz y Sinner, más que una final en juego en Montecarlo | https://www.flashscore.es/noticias/tenis-montecarlo-atp-individuales-todo-lo-que-se-juegan-alcaraz-y-sinner-en-montecarlo/O8zXUT5e/"
      ],
      tags: ["google-trending"]
    });

    expect(enrichment.draftLineageHint).toBe("sports_match_carlos_alcaraz_vs_jannik_sinner");
    expect(enrichment.draftRecurringTemplateId).toBe("sports-match-winner-v1");
    expect(enrichment.draftQuestion).toBe("Carlos Alcaraz vs Jannik Sinner (Monte Carlo Masters, Apr 12)");
    expect(enrichment.draftAmbiguityNotes).toEqual(
      expect.arrayContaining(["fetch-needed=overtime-settlement-rule"])
    );
  });

  it("keeps esports matchups in the two-way winner family", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "weibo vs bilibili gaming",
      summary: 'Google Trends IL shows "weibo vs bilibili gaming" as an active trend.',
      whyNow: '"weibo vs bilibili gaming" is trending in Israel right now.',
      observedAt: "2026-04-18T13:40:00.000Z",
      keyEntities: ["weibo vs bilibili gaming", "esports", "league of legends"],
      notes: [
        "LoL Esports: Weibo Gaming vs Bilibili Gaming | https://lolesports.com/en-US/news/weibo-gaming-vs-bilibili-gaming-preview-2026-04-18",
        "followup-title: Weibo Gaming vs Bilibili Gaming | https://lolesports.com/en-US/news/weibo-gaming-vs-bilibili-gaming-preview-2026-04-18"
      ],
      tags: ["google-trending", "esports", "league-of-legends"]
    });

    expect(enrichment.inferredCategory).toBe("sports");
    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftRecurringTemplateId).toBe("sports-match-winner-v1");
    expect(enrichment.draftOutcomes?.map((outcome) => outcome.label)).toEqual(["Weibo Gaming", "Bilibili Gaming"]);
    expect(enrichment.draftOutcomes?.map((outcome) => outcome.label)).not.toContain("Draw");
  });

  it("uses structured follow-up notes to close sports grounding gaps", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "chelsea vs man city",
      summary: 'Google Trends IL shows "chelsea vs man city" as an active trend.',
      whyNow: '"chelsea vs man city" is trending in Israel right now.',
      observedAt: "2026-04-12T13:40:00.000Z",
      keyEntities: ["chelsea vs man city"],
      notes: [
        "BBC: Chelsea vs Manchester City: preview | https://www.bbc.com/sport/football/live/cwyxndndp4pt",
        "followup-title: Chelsea vs Manchester City preview: Premier League team news, kickoff time | https://www.bbc.com/sport/football/live/cwyxndndp4pt",
        "followup-competition=Premier League | https://www.bbc.com/sport/football/live/cwyxndndp4pt",
        "followup-event-date=2026-04-12 | https://www.bbc.com/sport/football/live/cwyxndndp4pt"
      ],
      tags: ["google-trending"]
    });

    expect(enrichment.draftQuestion).toBe("Chelsea vs Manchester City (Premier League, Apr 12)");
    expect(enrichment.draftAmbiguityNotes).not.toEqual(expect.arrayContaining(["fetch-needed=exact-event-date"]));
    expect(enrichment.draftAmbiguityNotes).not.toEqual(expect.arrayContaining(["fetch-needed=competition-name"]));
    expect(enrichment.draftAmbiguityNotes).toEqual(expect.arrayContaining(["fetch-needed=regulation-settlement-rule"]));
  });

  it("can lift a local Hebrew fixture from coverage headlines on a broad competition trend", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "ליגה לאומית",
      summary: 'Google Trends IL shows "ליגה לאומית" as an active trend.',
      whyNow: '"ליגה לאומית" is trending in Israel right now.',
      observedAt: "2026-04-15T12:00:00.000Z",
      keyEntities: ["ליגה לאומית"],
      notes: [
        "ONE: מכבי פ\"ת - מכבי הרצליה: הרכבים לקראת המשחק | https://www.one.co.il/Article/519721.html",
        "followup-title: מכבי פ\"ת - מכבי הרצליה: הרכבים לקראת המשחק | https://www.one.co.il/Article/519721.html",
        "followup-competition=ליגה לאומית | https://www.one.co.il/Article/519721.html",
        "followup-event-date=2026-04-16 | https://www.one.co.il/Article/519721.html"
      ],
      tags: ["google-trending", "geo-il", "heartbeat"]
    });

    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftRecurringTemplateId).toBe("sports-regulation-3way-v1");
    expect(enrichment.draftQuestion).toBe("מכבי פ\"ת vs מכבי הרצליה (ליגה לאומית, Apr 16)");
    expect(enrichment.draftAmbiguityNotes).not.toEqual(expect.arrayContaining(["fetch-needed=competition-name"]));
    expect(enrichment.draftAmbiguityNotes).not.toEqual(expect.arrayContaining(["fetch-needed=exact-event-date"]));
  });

  it("can draft tournament-title buzz into the same canonical final matchup from coverage", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "monte carlo masters",
      summary: 'Google Trends IL shows "monte carlo masters" as an active trend.',
      whyNow: '"monte carlo masters" is trending in Israel right now.',
      observedAt: "2026-04-12T13:30:00.000Z",
      keyEntities: ["monte carlo masters"],
      notes: [
        "ATP Tour: Alcaraz & Sinner reignite remarkable rivalry in Monte-Carlo final: 'It\\'s the dream' | https://www.atptour.com/en/news/alcaraz-sinner-monte-carlo-2026-final-preview",
        "BBC: Monte Carlo Masters: Carlos Alcaraz to face Jannik Sinner for first time in 2026 in final | https://www.bbc.com/sport/tennis/articles/c77mkkgk4mvo"
      ],
      tags: ["google-trending"]
    });

    expect(enrichment.draftLineageHint).toBe("sports_match_carlos_alcaraz_vs_jannik_sinner");
    expect(enrichment.draftQuestion).toBe("Carlos Alcaraz vs Jannik Sinner (Monte Carlo Masters, Apr 12)");
  });

  it("does not draft dated follow-up markets when the deadline is already past", () => {
    const enrichment = enrichSignal({
      sourceId: "src_home_front_command",
      sourceClass: "authority",
      category: "security",
      title: "Update - Home Front Command Defensive Policy",
      summary:
        "Home Front Command update. The defensive policy was updated and will be in effect from Saturday, April 11, 2026, at 20:00 until Monday, April 13, 2026, at 18:00.",
      whyNow: 'Home Front Command published "Update - Home Front Command Defensive Policy".',
      observedAt: "2026-04-14T06:00:00.000Z"
    });

    expect(enrichment.marketability).toBe("follow-up-needed");
    expect(enrichment.draftQuestion).toBeUndefined();
    expect(enrichment.inferenceNotes).toContain(
      "Draft window already passed relative to signal timing; do not propose this event."
    );
  });

  it("classifies political/security public figures as follow-up-needed, not generic watch-only", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "ישראל כ״ץ",
      summary: 'Google Trends IL shows "ישראל כ״ץ" as an active trend.',
      whyNow: '"ישראל כ״ץ" is trending in Israel right now.',
      observedAt: "2026-04-12T10:00:00.000Z",
      keyEntities: ["ישראל כ״ץ"],
      tags: ["google-trending"]
    });

    expect(enrichment.inferredCategory).toBe("security");
    expect(enrichment.topicKind).toBe("person-buzz");
    expect(enrichment.marketability).toBe("follow-up-needed");
    expect(enrichment.draftQuestion).toBeUndefined();
  });

  it("keeps generic entity buzz in watch-only mode", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "יונה יהב",
      summary: 'Google Trends IL shows "יונה יהב" as an active trend.',
      whyNow: '"יונה יהב" is trending in Israel right now.',
      observedAt: "2026-04-09T10:00:00.000Z",
      keyEntities: ["יונה יהב"],
      tags: ["google-trending"]
    });

    expect(enrichment.topicKind).toBe("person-buzz");
    expect(enrichment.marketability).toBe("watch-only");
  });

  it("marks official security and travel alerts as follow-up-needed rather than market-shaped", () => {
    const homeFront = enrichSignal({
      sourceId: "src_home_front_command",
      sourceClass: "authority",
      category: "security",
      title: "Update - Home Front Command Defensive Policy",
      summary: "Home Front Command update. Policy remains unchanged.",
      whyNow: 'Home Front Command published "Update - Home Front Command Defensive Policy".',
      observedAt: "2026-04-09T10:00:00.000Z"
    });
    const iaa = enrichSignal({
      sourceId: "src_iaa_notifications",
      sourceClass: "authority",
      category: "travel",
      title: "Closure of the Airspace of the State of Israel to Civil Aviation",
      summary: "IAA notification. The public is requested not to arrive at airports until further notice.",
      whyNow: 'IAA published "Closure of the Airspace of the State of Israel to Civil Aviation".',
      observedAt: "2026-04-09T10:00:00.000Z"
    });

    expect(homeFront.inferredCategory).toBe("security");
    expect(homeFront.marketability).toBe("follow-up-needed");
    expect(iaa.topicKind).toBe("infrastructure-disruption");
    expect(iaa.marketability).toBe("follow-up-needed");
  });

  it("drafts a bounded Home Front defensive-policy follow-up market", () => {
    const enrichment = enrichSignal({
      sourceId: "src_home_front_command",
      sourceClass: "authority",
      category: "security",
      title: "Update - Home Front Command Defensive Policy",
      summary:
        "Home Front Command update. The defensive policy was updated and will be in effect from Saturday, April 11, 2026, at 20:00 until Monday, April 13, 2026, at 18:00.",
      whyNow: 'Home Front Command published "Update - Home Front Command Defensive Policy".',
      observedAt: "2026-04-12T06:00:00.000Z"
    });

    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftQuestion).toBe(
      "Will Home Front Command extend the current defensive policy beyond April 13, 2026 at 18:00?"
    );
    expect(enrichment.draftSensitivityLevel).toBe("elevated");
    expect(enrichment.draftRiskFlags).toContain("public-safety-sensitive");
  });

  it("drafts a bounded IAA operational-resumption follow-up market", () => {
    const enrichment = enrichSignal({
      sourceId: "src_iaa_notifications",
      sourceClass: "authority",
      category: "travel",
      title: "Resumption of Duty Free & Collect Package Pickup at Ben Gurion Airport",
      summary:
        "IAA notification. Following the ceasefire, we hereby inform that as of April 12, 2026, starting from midday, the Duty Free & Collect package pickup service at Ben Gurion Airport has resumed.",
      whyNow: "IAA published a resumption notice.",
      observedAt: "2026-04-12T11:32:00.000Z"
    });

    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftQuestion).toBe(
      "Will Duty Free & Collect Package Pickup remain available at Ben Gurion Airport after April 12, 2026?"
    );
    expect(enrichment.draftSuggestedResolutionAnchor).toBe("Israel Airports Authority official follow-up notice.");
  });

  it("does not auto-draft a BOI rate-decision market from bare attention chatter", () => {
    const enrichment = enrichSignal({
      sourceId: "src_google_trending_il",
      sourceClass: "attention",
      category: "general",
      title: "בנק ישראל ריבית",
      summary: "Bank of Israel interest rate decision is drawing attention.",
      whyNow: "Bank of Israel interest rate chatter is rising.",
      observedAt: "2026-04-09T10:00:00.000Z"
    });

    expect(enrichment.inferredCategory).toBe("economy");
    expect(enrichment.marketability).toBe("follow-up-needed");
    expect(enrichment.draftQuestion).toBeUndefined();
    expect(enrichment.draftLineageHint).toBe("boi_rate_decisions");
  });

  it("can draft a BOI rate-decision market when a planned-event date anchor exists", () => {
    const enrichment = enrichSignal({
      sourceId: "src_boi_announcements",
      sourceClass: "authority",
      category: "economy",
      title: "Publication dates of interest rate decisions - May 2026",
      summary: "The next Monetary Committee decision will be announced on May 25, 2026.",
      whyNow: "Bank of Israel published the decision schedule.",
      observedAt: "2026-04-12T10:00:00.000Z",
      notes: ["intake-lane=planned-event"],
      tags: ["planned-event"]
    });

    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftRecurringTemplateId).toBe("boi-rate-decision-v1");
    expect(enrichment.draftQuestion).toBe("החלטת בנק ישראל במאי?");
    expect(enrichment.draftSuggestedCloseShape).toBe("Close before May 25, 2026 at 16:00.");
    expect(enrichment.draftOutcomes?.map((outcome) => outcome.label)).toEqual([
      "ירידה של 0.50%+",
      "ירידה של 0.25%",
      "ללא שינוי",
      "עלייה של 0.25%",
      "עלייה של 0.50%+"
    ]);
    expect(enrichment.draftAmbiguityNotes).toEqual(
      expect.arrayContaining([
        "grounding: event-date=May 25, 2026",
        "grounding: publication-time=16:00"
      ])
    );
  });

  it("can draft a Fed rate-decision market with the same recurring bps template", () => {
    const enrichment = enrichSignal({
      sourceId: "src_federal_reserve_rss",
      sourceClass: "authority",
      category: "economy",
      title: "FOMC decision schedule - June 2026",
      summary: "The next Federal Reserve rate decision will be announced on June 17, 2026.",
      whyNow: "Federal Reserve published the decision schedule.",
      observedAt: "2026-04-12T10:00:00.000Z",
      notes: ["intake-lane=planned-event"],
      tags: ["planned-event"]
    });

    expect(enrichment.marketability).toBe("draft-ready");
    expect(enrichment.draftRecurringTemplateId).toBe("fed-rate-decision-v1");
    expect(enrichment.draftLineageHint).toBe("fed_rate_decisions");
    expect(enrichment.draftQuestion).toBe("Fed decision in June?");
    expect(enrichment.draftSuggestedCloseShape).toBe("Close before June 17, 2026.");
    expect(enrichment.draftSuggestedResolutionAnchor).toBe("Federal Reserve official rate announcement.");
    expect(enrichment.draftOutcomes?.map((outcome) => outcome.label)).toEqual([
      "ירידה של 0.50%+",
      "ירידה של 0.25%",
      "ללא שינוי",
      "עלייה של 0.25%",
      "עלייה של 0.50%+"
    ]);
  });

  it("suppresses BOI resolved decision releases from becoming fresh market drafts", () => {
    const enrichment = enrichSignal({
      sourceId: "src_boi_announcements",
      sourceClass: "authority",
      category: "economy",
      title: "The Monetary Committee decides on March 30, 2026 to leave the interest rate unchanged at 4.00 percent.",
      summary: "Resolved BOI decision release.",
      whyNow: "Bank of Israel published the decision outcome.",
      observedAt: "2026-03-30T10:00:00.000Z"
    });

    expect(enrichment.marketability).toBe("follow-up-needed");
    expect(enrichment.draftQuestion).toBeUndefined();
    expect(enrichment.draftLineageHint).toBe("boi_rate_decisions");
  });
});
