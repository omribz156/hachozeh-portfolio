import type {
  MarketFamilyClassificationInput,
  MarketFamilyRegistryEntry,
  MarketFamilySourceCandidate,
  MarketForm,
  MarketMeasurementKind,
  MarketResultShape,
  RecurringEventTemplateId,
  SensitivityLevel
} from "./contracts";

export type { MarketFamilyClassificationInput };

function source(
  sourceId: string,
  label: string,
  measurementKind: MarketMeasurementKind,
  resultShape: MarketResultShape,
  adapterReadiness: MarketFamilySourceCandidate["adapterReadiness"],
  notes?: string[]
): MarketFamilySourceCandidate {
  return {
    sourceId,
    label,
    route: {
      measurementKind,
      resultShape
    },
    adapterReadiness,
    notes
  };
}

export const seededMarketFamilyRegistry: MarketFamilyRegistryEntry[] = [
  {
    objectType: "market_family_registry_entry",
    familyKey: "politics.israeli-election-result",
    category: "politics",
    labelHe: "תוצאות בחירות בישראל",
    labelEn: "Israeli election result",
    marketForms: ["multi-outcome"],
    measurementKind: "official_value",
    resultShape: "multi_outcome",
    namingPatternHe: "מי תקבל הכי הרבה מנדטים בבחירות?",
    closePolicy: "סגירה לפני פתיחת הקלפיות או לפי החלטת מפעיל.",
    resolutionPolicy: "הכרעה לפי תוצאות רשמיות של ועדת הבחירות המרכזית.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_il_election_committee_results", "ועדת הבחירות המרכזית", "official_value", "multi_outcome", "adapter_needed")
    ],
    keywords: ["בחירות", "מנדטים", "קלפיות", "ועדת הבחירות"],
    notes: ["Use official results only, not polls."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "politics.knesset-election-occurrence",
    category: "politics",
    labelHe: "קיום בחירות לכנסת",
    labelEn: "Knesset election occurrence",
    marketForms: ["binary"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם יתקיימו בחירות לכנסת עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין שהוגדר, אלא אם נקבע אחרת.",
    resolutionPolicy: "הכרעה לפי ועדת הבחירות המרכזית והכנסת; הודעה או פיזור אינם מספיקים בלי יום בחירות שהתקיים בפועל.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_il_election_committee_results", "ועדת הבחירות המרכזית", "deadline_yes_no", "yes_no", "adapter_needed"),
      source("src_knesset_official", "הכנסת", "deadline_yes_no", "yes_no", "manual_allowed")
    ],
    keywords: ["בחירות", "כנסת", "קלפיות", "ועדת הבחירות"],
    notes: ["Different from results/mandate markets: this asks whether election day happened before a deadline."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "politics.party-mandate-threshold",
    category: "politics",
    labelHe: "סף מנדטים למפלגה",
    labelEn: "Party mandate threshold",
    marketForms: ["binary", "threshold", "multi-outcome", "range"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם {מפלגה} תקבל לפחות {מספר} מנדטים?",
    closePolicy: "סגירה לפני פתיחת הקלפיות או לפי החלטת מפעיל.",
    resolutionPolicy: "הכרעה לפי תוצאות רשמיות של ועדת הבחירות המרכזית.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_il_election_committee_results", "ועדת הבחירות המרכזית", "threshold_crossing", "yes_no", "adapter_needed")
    ],
    keywords: ["מנדטים", "מפלגה", "אחוז החסימה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "politics.official-vote-or-appointment",
    category: "politics",
    labelHe: "הצבעה או מינוי רשמי",
    labelEn: "Official vote or appointment",
    marketForms: ["binary"],
    measurementKind: "official_value",
    resultShape: "yes_no",
    namingPatternHe: "האם {אירוע פוליטי רשמי} יקרה?",
    closePolicy: "סגירה לפני מועד ההצבעה/הפרסום הרשמי.",
    resolutionPolicy: "הכרעה לפי פרסום רשמי של הכנסת או gov.il.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_knesset_official", "הכנסת", "official_value", "yes_no", "adapter_needed"),
      source("src_gov_il_news", "gov.il", "official_value", "yes_no", "adapter_needed")
    ],
    keywords: ["הצבעת אמון", "ממשלה", "מינוי", "התפטרות", "כנסת", "שר"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "security.official-alert-or-disruption",
    category: "security",
    labelHe: "התראה או שיבוש רשמי",
    labelEn: "Official alert or disruption",
    marketForms: ["binary", "threshold"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם {אירוע ביטחוני רשמי} יחצה את הסף?",
    closePolicy: "סגירה לפי חלון המדידה הרשמי ואישור מפעיל.",
    resolutionPolicy: "הכרעה לפי מקור רשמי בלבד.",
    sensitivityLevel: "high",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_home_front_command", "פיקוד העורף", "threshold_crossing", "yes_no", "policy_review"),
      source("src_iaa_notifications", "רשות שדות התעופה", "official_value", "yes_no", "adapter_needed"),
      source("src_idf_realtime_updates", "דובר צה\"ל", "official_value", "yes_no", "policy_review")
    ],
    keywords: ["פיקוד העורף", "אזעקה", "נתבג", "שדה תעופה", "דובר צהל", "חירום"],
    notes: ["Sensitive by default; route through policy review before public markets."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "security.direct-state-conflict",
    category: "security",
    labelHe: "עימות ישיר בין מדינות",
    labelEn: "Direct state conflict",
    marketForms: ["binary"],
    measurementKind: "reported_claim",
    resultShape: "yes_no",
    namingPatternHe: "האם {מדינה א} ו-{מדינה ב} ייכנסו לעימות צבאי ישיר עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין; YES מוקדם רק אחרי ראיות רשמיות/מאומתות ואישור מפעיל.",
    resolutionPolicy: "הכרעה לפי מקור רשמי כשאפשר, או חבילת דיווחים עצמאיים עם בדיקת מפעיל.",
    sensitivityLevel: "high",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_idf_realtime_updates", "דובר צה\"ל", "official_value", "yes_no", "policy_review"),
      source("src_gov_il_news", "gov.il", "official_value", "yes_no", "adapter_needed"),
      source("src_credible_reporting_bundle", "דיווחים מאומתים", "reported_claim", "yes_no", "manual_allowed")
    ],
    keywords: ["איראן", "ישראל", "עימות", "מלחמה", "תקיפה", "דובר צהל", "gov.il"],
    notes: ["Public markets in this family require explicit source hierarchy, fallback standard, and human approval."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "media.major-outlet-mention",
    category: "culture",
    labelHe: "אזכור בכלי תקשורת מרכזי",
    labelEn: "Major media mention",
    marketForms: ["binary"],
    measurementKind: "reported_claim",
    resultShape: "yes_no",
    namingPatternHe: "האם {נושא} יוזכר בכלי תקשורת מרכזי עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי פרסום מערכתי של מקור מאושר; מודעות, SEO וסינדיקציה לא מספיקים.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_credible_reporting_bundle", "דיווחים מאומתים", "reported_claim", "yes_no", "manual_allowed"),
      source("src_kan_news", "כאן", "reported_claim", "yes_no", "manual_allowed"),
      source("src_channel12_news", "חדשות 12/N12", "reported_claim", "yes_no", "manual_allowed"),
      source("src_ynet_news", "ynet", "reported_claim", "yes_no", "manual_allowed"),
      source("src_globes_news", "גלובס", "reported_claim", "yes_no", "manual_allowed")
    ],
    keywords: ["אזכור", "תקשורת", "כתבה", "ynet", "n12", "כאן", "גלובס", "כלכליסט"],
    notes: ["Source policy must count independent groups, not raw URLs; ynet and Calcalist share one group."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "economy.central-bank-rate-decision",
    category: "economy",
    labelHe: "החלטת ריבית של בנק מרכזי",
    labelEn: "Central bank rate decision",
    marketForms: ["binary", "multi-outcome"],
    measurementKind: "rate_direction",
    resultShape: "cut_hold_hike",
    namingPatternHe: "מה תהיה החלטת הריבית של {בנק מרכזי} ב-{תאריך}?",
    closePolicy: "סגירה לפני מועד פרסום ההחלטה הרשמי.",
    resolutionPolicy: "הכרעה לפי הודעת הריבית הרשמית של הבנק המרכזי הרלוונטי.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_boi_announcements", "בנק ישראל", "rate_direction", "cut_hold_hike", "built"),
      source("src_boi_announcements", "בנק ישראל", "rate_direction", "yes_no", "built"),
      source("src_federal_reserve_rss", "Federal Reserve", "rate_direction", "cut_hold_hike", "adapter_needed"),
      source("src_ecb_rss", "ECB", "rate_direction", "cut_hold_hike", "adapter_needed")
    ],
    recurringTemplateIds: ["boi-rate-decision-v1"],
    keywords: [
      "בנק ישראל",
      "ריבית",
      "החלטת ריבית",
      "fed",
      "fomc",
      "federal reserve",
      "ecb",
      "european central bank"
    ],
    notes: ["BOI is the built recurring template; Fed/ECB share the family but still need dedicated Oracle adapters."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "economy.official-statistic-print",
    category: "economy",
    labelHe: "פרסום נתון כלכלי רשמי",
    labelEn: "Official economic statistic print",
    marketForms: ["binary", "threshold", "multi-outcome", "range"],
    measurementKind: "official_value",
    resultShape: "multi_outcome",
    namingPatternHe: "מה יהיה הנתון הרשמי של {מדד}?",
    closePolicy: "סגירה לפני מועד פרסום הנתון הרשמי.",
    resolutionPolicy: "הכרעה לפי סדרת נתונים רשמית.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_cbs_time_series", "הלמ\"ס", "official_value", "multi_outcome", "adapter_needed"),
      source("src_cbs_time_series", "הלמ\"ס", "threshold_crossing", "yes_no", "adapter_needed"),
      source("src_imf_sdmx", "IMF SDMX", "official_value", "multi_outcome", "adapter_needed")
    ],
    keywords: ["מדד", "אינפלציה", "למס", "תוצר", "אבטלה", "cpi"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "economy.fx-threshold",
    category: "economy",
    labelHe: "שער יציג מול סף",
    labelEn: "Representative FX threshold",
    marketForms: ["binary", "threshold"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם השער היציג של {מטבע} יחצה את {סף}?",
    closePolicy: "סגירה לפני פרסום השער היציג הרלוונטי.",
    resolutionPolicy: "הכרעה לפי שער יציג רשמי של בנק ישראל.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_boi_exchange_rates", "שערים יציגים - בנק ישראל", "threshold_crossing", "yes_no", "built")
    ],
    keywords: ["שער יציג", "דולר", "יורו", "שקל", "מטבע", "fx"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "economy.live-fx-price",
    category: "economy",
    labelHe: "שער מט״ח חי",
    labelEn: "Live FX price",
    marketForms: ["binary", "threshold", "range", "multi-outcome"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם {צמד מטבעות} יהיה מעל/מתחת {סף} בזמן הסגירה או במהלך חלון מוגדר?",
    closePolicy: "סגירה בזמן המדידה המפורש או בסוף חלון התצפית; לא משתמשים בשער יציג כתחליף לשער חי.",
    resolutionPolicy: "הכרעה לפי snapshots timestamped של TradingView FX בצמד ובזמן הסגירה או לאורך חלון תצפית שהוגדר בחוזה.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_tradingview_fx", "TradingView FX", "threshold_crossing", "yes_no", "built"),
      source("src_tradingview_fx", "TradingView FX", "official_value", "multi_outcome", "built")
    ],
    keywords: ["tradingview", "forex", "fx", "מטח", "מט״ח", "דולר", "יורו", "שקל", "usdils", "eurils", "eurusd"],
    notes: [
      "Final-point contracts must include trustDisplayUrl plus machineResolutionEndpoint with timestamped close-time price data.",
      "Window-crossing contracts must set timeline.fxObservationMode=window, timeline.fxObservationCadenceMinutes, and a hachozeh://oracle/tradingview-fx-snapshot endpoint with from/to timestamps."
    ]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "sports.game-winner",
    category: "sports",
    labelHe: "מנצחת משחק",
    labelEn: "Game winner",
    marketForms: ["binary"],
    measurementKind: "final_winner",
    resultShape: "home_away_winner",
    namingPatternHe: "{בית} נגד {חוץ}",
    closePolicy: "סגירה לפני פתיחת המשחק.",
    resolutionPolicy: "הכרעה לפי התוצאה הרשמית הסופית.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_winner_league_basketball", "מנהלת ליגת העל בכדורסל", "final_winner", "home_away_winner", "built"),
      source("src_nba_official_games", "NBA", "final_winner", "home_away_winner", "built"),
      source("src_ibba_schedules", "איגוד הכדורסל", "final_winner", "home_away_winner", "built"),
      source("src_fiba_basketball_games", "FIBA", "final_winner", "home_away_winner", "built"),
      source("src_nike_liga_official", "Niké Liga", "final_winner", "home_away_winner", "built")
    ],
    recurringTemplateIds: ["sports-match-winner-v1"],
    keywords: ["משחק", "nba", "fiba", "eurobasket", "כדורסל", "סל", "winner league"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "sports.regulation-3way",
    category: "sports",
    labelHe: "תוצאת משחק ב-90 דקות",
    labelEn: "Regulation-time 3-way result",
    marketForms: ["multi-outcome"],
    measurementKind: "final_winner",
    resultShape: "three_way_result",
    namingPatternHe: "{בית} נגד {חוץ}",
    closePolicy: "סגירה לפני פתיחת המשחק.",
    resolutionPolicy: "הכרעה לפי תוצאת הזמן החוקי הרשמית.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_nike_liga_official", "Niké Liga", "final_winner", "three_way_result", "built"),
      source("src_ifa_fixtures_results", "ההתאחדות לכדורגל", "final_winner", "three_way_result", "built")
    ],
    recurringTemplateIds: ["sports-regulation-3way-v1"],
    keywords: ["תיקו", "כדורגל", "90 דקות", "מחצית", "תוצאה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "sports.tournament-advancement",
    category: "sports",
    labelHe: "זכייה או עלייה בטורניר",
    labelEn: "Tournament winner or advancement",
    marketForms: ["binary", "multi-outcome"],
    measurementKind: "final_winner",
    resultShape: "multi_outcome",
    namingPatternHe: "מי תזכה/תעפיל ב-{טורניר}?",
    closePolicy: "סגירה לפי שלב הטורניר הרלוונטי.",
    resolutionPolicy: "הכרעה לפי מקור רשמי של הטורניר.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_league_official", "מקור טורניר רשמי", "final_winner", "multi_outcome", "adapter_needed")
    ],
    keywords: ["אלופה", "תעפיל", "טורניר", "גמר", "זוכה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "crypto.daily-close-threshold",
    category: "crypto",
    labelHe: "סגירת מחיר יומית מול סף",
    labelEn: "Daily crypto close threshold",
    marketForms: ["binary", "threshold"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם {מטבע} יסגור מעל {סף}?",
    closePolicy: "סגירה לפני סוף יום המדידה.",
    resolutionPolicy: "הכרעה לפי נר יומי רשמי/קנוני.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_coinbase_exchange_candles", "Coinbase Exchange candles", "threshold_crossing", "yes_no", "built"),
      source("src_https_www_binance_com_en_markets_overview", "Binance spot markets", "threshold_crossing", "yes_no", "manual_allowed"),
      source("src_chainlink_data_streams", "Chainlink Data Streams", "threshold_crossing", "yes_no", "adapter_needed")
    ],
    keywords: ["ביטקוין", "אתריום", "סולנה", "קריפטו", "יסגור", "btc", "eth", "sol", "bnb", "xrp", "doge", "binance"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "crypto.daily-close-range",
    category: "crypto",
    labelHe: "טווח סגירת מחיר יומי",
    labelEn: "Daily crypto close range",
    marketForms: ["multi-outcome", "range"],
    measurementKind: "official_value",
    resultShape: "multi_outcome",
    namingPatternHe: "באיזה טווח {מטבע} יסגור?",
    closePolicy: "סגירה לפני סוף יום המדידה.",
    resolutionPolicy: "הכרעה לפי נר יומי רשמי/קנוני.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_coinbase_exchange_candles", "Coinbase Exchange candles", "official_value", "multi_outcome", "built")
    ],
    keywords: ["טווח", "מחיר", "קריפטו", "ביטקוין", "אתריום", "range"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "crypto.protocol-milestone",
    category: "crypto",
    labelHe: "אבן דרך בפרוטוקול",
    labelEn: "Protocol milestone",
    marketForms: ["binary"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם {פרויקט} ישיק/ישלים {אבן דרך} עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי מקור רשמי של הפרויקט.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_protocol_official", "מקור רשמי של הפרוטוקול", "deadline_yes_no", "yes_no", "adapter_needed"),
      source("src_github_releases", "GitHub Releases", "deadline_yes_no", "yes_no", "adapter_needed")
    ],
    keywords: ["שדרוג", "mainnet", "פרוטוקול", "release", "github"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "legislation.bill-deadline",
    category: "legislation",
    labelHe: "חוק או הצעת חוק עד דדליין",
    labelEn: "Bill or law by deadline",
    marketForms: ["binary"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם {חוק} יעבור/יפורסם עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין או לפני ההצבעה הרלוונטית.",
    resolutionPolicy: "הכרעה לפי הכנסת/רשומות/פרסום רשמי.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_knesset_official", "הכנסת", "deadline_yes_no", "yes_no", "adapter_needed"),
      source("src_reshumot_official", "רשומות", "deadline_yes_no", "yes_no", "adapter_needed")
    ],
    keywords: ["חוק", "הצעת חוק", "קריאה", "רשומות", "תקנה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "technology.github-release-deadline",
    category: "technology",
    labelHe: "גרסת GitHub עד דדליין",
    labelEn: "GitHub release by deadline",
    marketForms: ["binary"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם {פרויקט} יוציא גרסה עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי GitHub Releases הרשמי של הפרויקט.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_github_releases", "GitHub Releases", "deadline_yes_no", "yes_no", "adapter_needed")
    ],
    keywords: ["github", "release", "גרסה", "השקה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "technology.standard-or-cve-state",
    category: "technology",
    labelHe: "סטטוס תקן או CVE",
    labelEn: "Standard or CVE state",
    marketForms: ["binary", "threshold"],
    measurementKind: "official_value",
    resultShape: "yes_no",
    namingPatternHe: "האם {תקן/חולשה} יגיע לסטטוס {סטטוס}?",
    closePolicy: "סגירה לפי חלון המדידה הרשמי.",
    resolutionPolicy: "הכרעה לפי API רשמי.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_ietf_datatracker", "IETF Datatracker", "official_value", "yes_no", "adapter_needed"),
      source("src_nvd_cve_api", "NVD CVE API", "threshold_crossing", "yes_no", "adapter_needed")
    ],
    keywords: ["ietf", "cve", "nvd", "תקן", "חולשה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "entertainment.eurovision-result",
    category: "culture",
    labelHe: "תוצאת אירוויזיון",
    labelEn: "Eurovision result",
    marketForms: ["binary", "multi-outcome"],
    measurementKind: "final_winner",
    resultShape: "yes_no",
    namingPatternHe: "האם/מי תזכה באירוויזיון?",
    closePolicy: "סגירה לפני תחילת ההצבעה/השידור לפי החלטת מפעיל.",
    resolutionPolicy: "הכרעה לפי טבלת התוצאות הרשמית של Eurovision.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_eurovision_official", "Eurovision official scoreboard", "final_winner", "yes_no", "built"),
      source("src_eurovision_official", "Eurovision official scoreboard", "official_value", "multi_outcome", "built")
    ],
    keywords: ["אירוויזיון", "eurovision", "טופ", "שופטים", "קהל"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "entertainment.award-winner",
    category: "culture",
    labelHe: "זוכה בפרס",
    labelEn: "Award winner",
    marketForms: ["binary", "multi-outcome"],
    measurementKind: "final_winner",
    resultShape: "multi_outcome",
    namingPatternHe: "מי תזכה ב-{פרס}?",
    closePolicy: "סגירה לפני תחילת טקס הפרסים או לפי חלון ההכרזה.",
    resolutionPolicy: "הכרעה לפי מאגר/פרסום רשמי של הגוף המחלק.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_awards_official", "Official awards database", "final_winner", "multi_outcome", "adapter_needed")
    ],
    keywords: ["אוסקר", "פרס", "טקס", "זוכה", "emmy", "oscar"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "entertainment.reality-show-result",
    category: "culture",
    labelHe: "תוצאה בתוכנית ריאליטי",
    labelEn: "Reality show result",
    marketForms: ["binary", "multi-outcome"],
    measurementKind: "final_winner",
    resultShape: "multi_outcome",
    namingPatternHe: "מי תזכה/תודח ב-{תוכנית}?",
    closePolicy: "סגירה לפני פרק ההכרעה/ההדחה.",
    resolutionPolicy: "הכרעה לפי פרסום רשמי של התוכנית.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_show_official", "Official show page", "final_winner", "multi_outcome", "built", [
        "Final-resolution adapter supports clear official winner/elimination language; close remains scheduled/operator-gated."
      ])
    ],
    keywords: ["האח הגדול", "המרוץ למיליון", "ריאליטי", "תודח", "תזכה"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "entertainment.show-season-release",
    category: "culture",
    labelHe: "עליית עונה או פרק רשמי",
    labelEn: "Official show season or episode release",
    marketForms: ["binary"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם {תוכנית} תעלה עונה/פרק עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי עמוד רשמי של התוכנית או הגוף המשדר; הודעה, טריילר או ספיישל לא מספיקים אם הכללים דורשים פרק עונה.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_kan_ipbc_show_pages", "כאן / תאגיד השידור", "deadline_yes_no", "yes_no", "manual_allowed"),
      source("src_show_official", "Official show page", "deadline_yes_no", "yes_no", "manual_allowed")
    ],
    keywords: ["קופה ראשית", "עונה", "פרק", "כאן", "תוכנית", "שידור"],
    notes: ["Use for episode/season availability markets, not winner/elimination markets."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "weather.ims-threshold",
    category: "weather",
    labelHe: "מדידת מזג אוויר רשמית מול סף",
    labelEn: "Official weather threshold",
    marketForms: ["binary", "threshold"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם {מדידה} ב-{תחנה} תחצה את {סף}?",
    closePolicy: "סגירה לפני תחילת יום המדידה או לפני חלון המדידה.",
    resolutionPolicy: "הכרעה לפי נתוני תצפית רשמיים של השירות המטאורולוגי.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_ims_daily_observations", "השירות המטאורולוגי הישראלי", "threshold_crossing", "yes_no", "built"),
      source("src_ims_daily_observations", "השירות המטאורולוגי הישראלי", "official_value", "multi_outcome", "built"),
      source("src_noaa_cdo", "NOAA CDO", "threshold_crossing", "yes_no", "adapter_needed")
    ],
    keywords: ["טמפרטורה", "גשם", "מעלות", "תחנה", "weather", "ims"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "health.official-status-or-approval",
    category: "health",
    labelHe: "אישור או סטטוס בריאות רשמי",
    labelEn: "Official health status or approval",
    marketForms: ["binary", "threshold"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם {מוצר/ניסוי/פרסום} יקבל סטטוס רשמי עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי API/פרסום רשמי.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_openfda_drugs", "openFDA", "deadline_yes_no", "yes_no", "adapter_needed"),
      source("src_clinicaltrials_v2", "ClinicalTrials.gov", "official_value", "yes_no", "adapter_needed"),
      source("src_moh_il", "משרד הבריאות", "official_value", "yes_no", "adapter_needed")
    ],
    keywords: ["fda", "תרופה", "ניסוי", "משרד הבריאות", "clinical"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "health.who-pandemic-declaration",
    category: "health",
    labelHe: "הכרזת מגיפה עולמית של WHO",
    labelEn: "WHO global pandemic declaration",
    marketForms: ["binary"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם WHO יכריז על מגיפה עולמית עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי פרסום רשמי של WHO שמכריז או מתאר התפרצות כמגיפה עולמית.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_who_official", "WHO", "deadline_yes_no", "yes_no", "manual_allowed"),
      source("src_credible_reporting_bundle", "דיווחים מאומתים", "reported_claim", "yes_no", "manual_allowed")
    ],
    keywords: ["who", "מגיפה", "pandemic", "בריאות", "התפרצות"],
    notes: ["PHEIC alone is not enough unless the market rules explicitly say so."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "travel.airline-base-announcement",
    category: "travel",
    labelHe: "בסיס פעילות של חברת תעופה",
    labelEn: "Airline base announcement",
    marketForms: ["binary"],
    measurementKind: "reported_claim",
    resultShape: "yes_no",
    namingPatternHe: "האם חברת תעופה זרה תפתח בסיס פעילות ב-{שדה} עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה רק כשיש גם הודעת חברה וגם אישור ישראלי רשמי המתייחסים לאותו מהלך.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_iaa_notifications", "רשות שדות התעופה", "reported_claim", "yes_no", "manual_allowed"),
      source("src_mot_il_official", "משרד התחבורה", "reported_claim", "yes_no", "manual_allowed"),
      source("src_airline_company_announcements", "הודעת חברת תעופה", "reported_claim", "yes_no", "manual_allowed")
    ],
    keywords: ["נתבג", "חברת תעופה", "בסיס פעילות", "טיסות", "wizz", "airport"],
    notes: ["Paired-source family: one-sided announcements do not resolve YES."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "transport.ride-service-launch",
    category: "transportation",
    labelHe: "השקת שירות נסיעות בישראל",
    labelEn: "Ride service launch in Israel",
    marketForms: ["binary"],
    measurementKind: "reported_claim",
    resultShape: "yes_no",
    namingPatternHe: "האם {חברה} תתחיל להפעיל שירות נסיעות בישראל עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין.",
    resolutionPolicy: "הכרעה לפי שירות פעיל לציבור בישראל, עם מקור חברה/אפליקציה ומקור רגולטורי או רשמי כשנדרש.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_mot_il_official", "משרד התחבורה", "reported_claim", "yes_no", "manual_allowed"),
      source("src_transport_company_announcements", "הודעת חברת תחבורה", "reported_claim", "yes_no", "manual_allowed"),
      source("src_credible_reporting_bundle", "דיווחים מאומתים", "reported_claim", "yes_no", "manual_allowed")
    ],
    keywords: ["תחבורה", "נסיעות", "מוניות", "אובר", "bolt", "lyft", "indrive"],
    notes: ["Visible rules must list eligible companies and exclude delivery, micromobility, rental cars, and public transit."]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "energy.official-energy-value",
    category: "energy",
    labelHe: "נתון אנרגיה רשמי",
    labelEn: "Official energy value",
    marketForms: ["binary", "threshold", "multi-outcome", "range"],
    measurementKind: "threshold_crossing",
    resultShape: "yes_no",
    namingPatternHe: "האם {נתון אנרגיה} יחצה את {סף}?",
    closePolicy: "סגירה לפני פרסום הנתון הרשמי.",
    resolutionPolicy: "הכרעה לפי מקור אנרגיה רשמי.",
    sensitivityLevel: "normal",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_eia_open_data", "EIA Open Data", "threshold_crossing", "yes_no", "adapter_needed"),
      source("src_energy_ministry_il", "משרד האנרגיה", "official_value", "multi_outcome", "adapter_needed"),
      source("src_il_electricity_data", "נתוני חשמל בישראל", "threshold_crossing", "yes_no", "adapter_needed")
    ],
    keywords: ["אנרגיה", "חשמל", "נפט", "גז", "eia", "דלק"]
  },
  {
    objectType: "market_family_registry_entry",
    familyKey: "education.official-deadline-or-stat",
    category: "education",
    labelHe: "דדליין או נתון חינוך רשמי",
    labelEn: "Official education deadline or statistic",
    marketForms: ["binary", "threshold"],
    measurementKind: "deadline_yes_no",
    resultShape: "yes_no",
    namingPatternHe: "האם {אירוע חינוך רשמי} יקרה עד {תאריך}?",
    closePolicy: "סגירה בסוף חלון הדדליין או לפני פרסום הנתון.",
    resolutionPolicy: "הכרעה לפי משרד החינוך או סדרת נתונים רשמית.",
    sensitivityLevel: "elevated",
    operatorDecisionRequired: true,
    sourceCandidates: [
      source("src_moe_il_calendar", "משרד החינוך - לוח שנה", "deadline_yes_no", "yes_no", "adapter_needed"),
      source("src_moe_il_news", "משרד החינוך - הודעות", "deadline_yes_no", "yes_no", "adapter_needed"),
      source("src_cbs_time_series", "הלמ\"ס", "threshold_crossing", "yes_no", "adapter_needed")
    ],
    keywords: ["חינוך", "בגרות", "לימודים", "חופשה", "משרד החינוך"]
  }
];

export function findSeededMarketFamilyByKey(familyKey: string): MarketFamilyRegistryEntry | undefined {
  return seededMarketFamilyRegistry.find((family) => family.familyKey === familyKey);
}

export function findSeededMarketFamilyByRecurringTemplateId(
  recurringTemplateId: RecurringEventTemplateId
): MarketFamilyRegistryEntry | undefined {
  return seededMarketFamilyRegistry.find((family) =>
    family.recurringTemplateIds?.includes(recurringTemplateId)
  );
}

export function resolveMarketKindIdForRecurringTemplate(
  recurringTemplateId: RecurringEventTemplateId | undefined
): string | undefined {
  return recurringTemplateId
    ? findSeededMarketFamilyByRecurringTemplateId(recurringTemplateId)?.familyKey
    : undefined;
}

export function validateSeededMarketFamilyRegistry(): string[] {
  const issues: string[] = [];
  const byFamilyKey = new Map<string, number>();
  const byRecurringTemplateId = new Map<RecurringEventTemplateId, string[]>();

  for (const family of seededMarketFamilyRegistry) {
    byFamilyKey.set(family.familyKey, (byFamilyKey.get(family.familyKey) ?? 0) + 1);

    for (const recurringTemplateId of family.recurringTemplateIds ?? []) {
      byRecurringTemplateId.set(recurringTemplateId, [
        ...(byRecurringTemplateId.get(recurringTemplateId) ?? []),
        family.familyKey
      ]);
    }
  }

  for (const [familyKey, count] of byFamilyKey) {
    if (count > 1) {
      issues.push(`duplicate-family-key:${familyKey}`);
    }
  }

  for (const [recurringTemplateId, familyKeys] of byRecurringTemplateId) {
    if (familyKeys.length > 1) {
      issues.push(`recurring-template-maps-to-multiple-market-kinds:${recurringTemplateId}:${familyKeys.join(",")}`);
    }
  }

  return issues;
}
