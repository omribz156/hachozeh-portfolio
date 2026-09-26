export type MarketDetailContext = {
  sectionLabel: string;
  categoryLabel: string;
  categoryHref: string;
  marketLabel: string;
  publicPath?: string | null;
  brandAlt: string;
  // brandImageUrl is the SVG icon — always present when Seer's curation or a
  // category bucket matches. null only when no asset was found at all.
  brandImageUrl: string | null;
  // brandPhotoUrl is the editorial photo — present when the curated asset has
  // a photoPath in the registry. Surfaces that earn a photo (market-detail
  // header, hero) render this; surfaces that don't (cards) keep the SVG.
  brandPhotoUrl?: string | null;
};

export type MarketDetailChartPoint = {
  label: string;
  at: string;
  t?: number;
  values: Record<string, number>;
};

export type MarketDetailRelatedMarket = {
  title: string;
  probability: string;
  probabilityClass: string;
  volumeLabel: string | null;
  href: string;
};

export type MarketDetailChainItem = {
  id: string;
  label: string;
  href: string;
  temporalStatus?: "past" | "current" | "future";
  disabled?: boolean;
};

export type MarketDetailTimelineItem = {
  title: string;
  time: string;
  dotClass: string;
  titleClass: string;
  timeClass: string;
};

export type MarketDetailOutcome = {
  id: string;
  key: string;
  label: string;
  shortLabel: string;
  colorPrimary?: string;
  colorOn?: string;
  // Served path to the team flag/crest SVG, surfaced from the same team-brand
  // registry that already supplies colorPrimary. Present only for entity outcomes
  // (teams/countries) the registry knows; absent for tie/non-sports outcomes.
  crestPath?: string;
  finalValue?: number;
};

export type MarketDetailResolutionSummary = {
  winningOutcomeKey: string;
  winningOutcomeLabel: string;
  sourceUrl: string;
  explanation: string;
  resolvedAtLabel: string;
};

export type MarketDetailResultSummary = {
  status: string;
  settlementStatus: string | null;
  resolvedAt: string | null;
  resolvedAtLabel: string | null;
  winner: {
    outcomeId: string;
    outcomeKey: string;
    label: string;
  } | null;
  source: {
    label: string | null;
    url: string | null;
    rules: string | null;
    explanation: string | null;
  };
};

export type MarketDetailEventUpdate = {
  id: string;
  eventType: string;
  tier: string;
  summary: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  observedAt: string;
  createdBy: string;
  linksToCaseId: string | null;
};

export type MarketDetailEventSummary = {
  id: string;
  title: string;
  description?: string | null;
  status: string;
  icon?: string | null;
  resolutionPolicy: string;
  rulesLead?: string | null;
  delayPolicy?: string | null;
  resolutionSource?: {
    label: string | null;
    url: string | null;
  } | null;
  childCount: number;
  volumeLabel: string | null;
  // Operator authoring flag (events.display_flags.showGraph): render the
  // multi-line probability chart in the event detail view. Default false.
  showGraph: boolean;
};

type MarketDetailEventChildOutcome = {
  side: "yes" | "no" | "outcome";
  label: string;
  price: number;
  outcomeId?: string;
  outcomeKey?: string;
};

export type MarketDetailEventChild = {
  marketId: string;
  label: string;
  status: string;
  crestPath?: string | null;
  canonicalProbability: number | null;
  outcomes: MarketDetailEventChildOutcome[];
  winner: string | null;
  volumeLabel: string | null;
  viewerPosition: null;
};

type MarketDetailTrustSummary = {
  resolutionSource: string | null;
  sourceUrl?: string | null;
  resolutionRules: string | null;
  sourceRolePlan: {
    wake: string[];
    ground: string[];
    resolve: string[];
    integrity: string[];
  };
  fetchNeeds: string[];
  sourcePolicySummary: {
    preferredSourceCount: number;
    contextSourceCount: number;
    closeConditionSourceCount: number;
    resolutionSourceCount: number;
    fallbackSourceCount: number;
    requiresHumanReviewOnSourceConflict: boolean;
    requiresHumanReviewOnWeakAuthority: boolean;
  };
};

type MarketDetailMarketContract = {
  objectType: "market_contract_v1";
  [key: string]: unknown;
};

type MarketDetailSnapshot = {
  marketStatus?: string;
  tradingMode?: "direct_outcome" | "contract_side";
  settlementStatus?: string | null;
  resolvedAt?: string | null;
  winner?: MarketDetailResultSummary["winner"];
  result?: MarketDetailResultSummary;
  event?: MarketDetailEventSummary;
  children?: MarketDetailEventChild[];
  eventUpdates?: MarketDetailEventUpdate[];
  lifecycle?: {
    openAt: string;
    closeAt: string;
    expectedResolutionAt: string | null;
    publishedAt: string | null;
    updatedAt: string;
    resolvedAt: string | null;
    persistedStatus: string;
    effectiveStatus: string;
    settlementStatus: string | null;
    payoutPolicy: unknown;
  };
  updatedLabel: string;
  marketStateVersion: number;
  volumeLabel: string | null;
  closeLabel: string;
  current: Record<string, number>;
  outcomes?: MarketDetailOutcome[];
  resolution?: MarketDetailResolutionSummary;
  trust?: MarketDetailTrustSummary;
  contract?: MarketDetailMarketContract;
  outcomeVolumes: Record<string, string | null>;
  rulesLead: string;
  relatedMarkets: MarketDetailRelatedMarket[];
  timeline: MarketDetailTimelineItem[];
  timeframes?: Record<string, MarketDetailChartPoint[]>;
};

export type MarketDetailPassiveRecord = {
  context: MarketDetailContext;
  snapshot: MarketDetailSnapshot;
  chain?: MarketDetailChainItem[];
  // Recurring-series key (markets.market_family_key), when this market belongs to a
  // series. Lets the frontend link the chain rail to the series hub (/series/{key}).
  marketFamilyKey?: string | null;
};

function createPoint(label: string, at: string, holdValue: number, cut025Value: number) {
  const cut050PlusValue = Number(Math.max(0, 1 - holdValue - cut025Value).toFixed(4));

  return {
    label,
    at,
    values: {
      hold: holdValue,
      "cut-025": cut025Value,
      "cut-050-plus": cut050PlusValue
    }
  } satisfies MarketDetailChartPoint;
}

function createFourWayPoint(
  label: string,
  at: string,
  optionA: number,
  optionB: number,
  optionC: number,
  optionD: number
) {
  return {
    label,
    at,
    values: {
      "option-a": optionA,
      "option-b": optionB,
      "option-c": optionC,
      "option-d": optionD
    }
  } satisfies MarketDetailChartPoint;
}

// Fixture context: brandImageUrl now points at local registry SVG buckets
// rather than hardcoded lh3.googleusercontent.com / images.unsplash.com URLs.
const MARKET_CONTEXT: MarketDetailContext = {
  sectionLabel: "שווקים",
  categoryLabel: "כלכלה",
  categoryHref: "/trending?category=economy",
  marketLabel: "ריבית בנק ישראל",
  brandAlt: "כלכלה",
  brandImageUrl: "/assets/images/market-buckets/economy.svg"
};

const NEXT_PRIME_MINISTER_CONTEXT: MarketDetailContext = {
  sectionLabel: "שווקים",
  categoryLabel: "פוליטיקה",
  categoryHref: "/trending?category=politics",
  marketLabel: "מי יהיה ראש הממשלה הבא?",
  brandAlt: "פוליטיקה",
  brandImageUrl: "/assets/images/market-buckets/politics.svg"
};

export const MARKET_DETAIL_RECORDS: Record<string, MarketDetailPassiveRecord> = {
  "mar-18": {
    context: MARKET_CONTEXT,
    snapshot: {
      updatedLabel: "18 מרץ 2026 · 14:00",
      marketStateVersion: 184,
      volumeLabel: "V₪ 32M",
      closeLabel: "18 במרץ",
      current: {
        hold: 0.93,
        "cut-025": 0.065,
        "cut-050-plus": 0.005
      },
      outcomeVolumes: {
        hold: "V₪ 15.1M",
        "cut-025": "V₪ 8.2M",
        "cut-050-plus": "V₪ 1.5M"
      },
      rulesLead: "שוק זה ייסגר לפי הכרזת הריבית של בנק ישראל במועד הקרוב.",
      relatedMarkets: [
        {
          title: "האם הנגיד ידבר על הורדת ריבית?",
          probability: "72%",
          probabilityClass: "text-neon-blue",
          volumeLabel: "V₪ 4.2M",
          href: "/markets/governor-cut-talk"
        },
        {
          title: "שער הדולר יגיע ל-3.6 ש\"ח עד מרץ?",
          probability: "45%",
          probabilityClass: "text-neon-green",
          volumeLabel: "V₪ 12.8M",
          href: "/markets/usd-ils-march-target"
        },
        {
          title: "אינפלציה שנתית מתחת ל-3%?",
          probability: "15%",
          probabilityClass: "text-danger",
          volumeLabel: "V₪ 8.5M",
          href: "/markets/annual-inflation-below-3"
        }
      ],
      timeline: [
        {
          title: "פתיחת השוק",
          time: "29 ספט' 2025 · 10:00",
          dotClass: "bg-success",
          titleClass: "text-white",
          timeClass: "text-slate-400"
        },
        {
          title: "סגירת השוק",
          time: "18 מרץ 2026 · 13:59",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        },
        {
          title: "ביצוע תשלום",
          time: "18 מרץ 2026 · 14:09",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        }
      ],
      timeframes: {
        hour: [
          createPoint("13:00", "18 מרץ · 13:00", 0.91, 0.08),
          createPoint("13:10", "18 מרץ · 13:10", 0.905, 0.09),
          createPoint("13:20", "18 מרץ · 13:20", 0.9, 0.095),
          createPoint("13:30", "18 מרץ · 13:30", 0.88, 0.11),
          createPoint("13:40", "18 מרץ · 13:40", 0.865, 0.125),
          createPoint("13:50", "18 מרץ · 13:50", 0.89, 0.102),
          createPoint("14:00", "18 מרץ · 14:00", 0.93, 0.065)
        ],
        day: [
          createPoint("08:00", "18 מרץ · 08:00", 0.94, 0.055),
          createPoint("08:45", "18 מרץ · 08:45", 0.942, 0.053),
          createPoint("09:30", "18 מרץ · 09:30", 0.94, 0.055),
          createPoint("10:15", "18 מרץ · 10:15", 0.95, 0.045),
          createPoint("11:00", "18 מרץ · 11:00", 0.946, 0.05),
          createPoint("11:45", "18 מרץ · 11:45", 0.93, 0.065),
          createPoint("12:30", "18 מרץ · 12:30", 0.92, 0.075),
          createPoint("13:15", "18 מרץ · 13:15", 0.86, 0.13),
          createPoint("14:00", "18 מרץ · 14:00", 0.88, 0.11),
          createPoint("15:00", "18 מרץ · 15:00", 0.91, 0.08),
          createPoint("16:00", "18 מרץ · 16:00", 0.93, 0.065)
        ],
        month: [
          createPoint("18.02", "18 פבר' 2026", 0.78, 0.18),
          createPoint("25.02", "25 פבר' 2026", 0.8, 0.17),
          createPoint("04.03", "04 מרץ 2026", 0.82, 0.155),
          createPoint("08.03", "08 מרץ 2026", 0.85, 0.13),
          createPoint("12.03", "12 מרץ 2026", 0.89, 0.095),
          createPoint("15.03", "15 מרץ 2026", 0.91, 0.08),
          createPoint("18.03", "18 מרץ 2026", 0.93, 0.065)
        ],
        all: [
          createPoint("אוק'", "אוקטובר 2025", 0.67, 0.24),
          createPoint("נוב'", "נובמבר 2025", 0.7, 0.22),
          createPoint("דצמ'", "דצמבר 2025", 0.73, 0.2),
          createPoint("ינו'", "ינואר 2026", 0.78, 0.17),
          createPoint("פבר'", "פברואר 2026", 0.84, 0.12),
          createPoint("מרץ", "מרץ 2026", 0.93, 0.065)
        ]
      }
    }
  },
  "apr-29": {
    context: MARKET_CONTEXT,
    snapshot: {
      updatedLabel: "29 אפר' 2026 · 13:15",
      marketStateVersion: 201,
      volumeLabel: "V₪ 24M",
      closeLabel: "29 באפריל",
      current: {
        hold: 0.61,
        "cut-025": 0.31,
        "cut-050-plus": 0.08
      },
      outcomeVolumes: {
        hold: "V₪ 9.7M",
        "cut-025": "V₪ 7.9M",
        "cut-050-plus": "V₪ 3.4M"
      },
      rulesLead: "שוק זה ייסגר לפי הכרזת הריבית של בנק ישראל ב-29 באפריל.",
      relatedMarkets: [
        {
          title: "שיעור האבטלה ירד מתחת ל-3.8%?",
          probability: "44%",
          probabilityClass: "text-neon-blue",
          volumeLabel: "V₪ 4.3M",
          href: "/markets/unemployment-below-3-8"
        },
        {
          title: "האינפלציה תחזור מעל 3% בפרסום הבא?",
          probability: "36%",
          probabilityClass: "text-neon-green",
          volumeLabel: "V₪ 5.7M",
          href: "/markets/inflation-back-above-3"
        },
        {
          title: "השקל יתחזק מול הדולר בשבוע ההחלטה?",
          probability: "52%",
          probabilityClass: "text-neon-blue",
          volumeLabel: "V₪ 3.9M",
          href: "/markets/shekel-strength-week"
        }
      ],
      timeline: [
        {
          title: "פתיחת השוק",
          time: "18 מרץ 2026 · 14:15",
          dotClass: "bg-success",
          titleClass: "text-white",
          timeClass: "text-slate-400"
        },
        {
          title: "סגירת השוק",
          time: "29 אפר' 2026 · 13:59",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        },
        {
          title: "ביצוע תשלום",
          time: "29 אפר' 2026 · 14:09",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        }
      ],
      timeframes: {
        hour: [
          createPoint("12:20", "29 אפר' · 12:20", 0.64, 0.28),
          createPoint("12:30", "29 אפר' · 12:30", 0.635, 0.285),
          createPoint("12:40", "29 אפר' · 12:40", 0.63, 0.29),
          createPoint("12:50", "29 אפר' · 12:50", 0.62, 0.3),
          createPoint("13:00", "29 אפר' · 13:00", 0.615, 0.305),
          createPoint("13:10", "29 אפר' · 13:10", 0.61, 0.31),
          createPoint("13:15", "29 אפר' · 13:15", 0.61, 0.31)
        ],
        day: [
          createPoint("08:00", "29 אפר' · 08:00", 0.68, 0.24),
          createPoint("08:45", "29 אפר' · 08:45", 0.67, 0.25),
          createPoint("09:30", "29 אפר' · 09:30", 0.66, 0.26),
          createPoint("10:15", "29 אפר' · 10:15", 0.645, 0.275),
          createPoint("11:00", "29 אפר' · 11:00", 0.64, 0.28),
          createPoint("11:45", "29 אפר' · 11:45", 0.63, 0.29),
          createPoint("12:30", "29 אפר' · 12:30", 0.62, 0.3),
          createPoint("13:15", "29 אפר' · 13:15", 0.61, 0.31)
        ],
        month: [
          createPoint("18.03", "18 מרץ 2026", 0.93, 0.065),
          createPoint("25.03", "25 מרץ 2026", 0.88, 0.1),
          createPoint("01.04", "01 אפר' 2026", 0.82, 0.14),
          createPoint("08.04", "08 אפר' 2026", 0.76, 0.18),
          createPoint("15.04", "15 אפר' 2026", 0.71, 0.22),
          createPoint("22.04", "22 אפר' 2026", 0.66, 0.26),
          createPoint("29.04", "29 אפר' 2026", 0.61, 0.31)
        ],
        all: [
          createPoint("מרץ", "מרץ 2026", 0.93, 0.065),
          createPoint("סוף מרץ", "סוף מרץ 2026", 0.84, 0.13),
          createPoint("תח' אפר'", "תחילת אפריל 2026", 0.78, 0.17),
          createPoint("אמצע אפר'", "אמצע אפריל 2026", 0.7, 0.23),
          createPoint("סוף אפר'", "סוף אפריל 2026", 0.61, 0.31)
        ]
      }
    }
  },
  "jun-17": {
    context: MARKET_CONTEXT,
    snapshot: {
      updatedLabel: "17 יונ' 2026 · 11:30",
      marketStateVersion: 228,
      volumeLabel: "V₪ 19M",
      closeLabel: "17 ביוני",
      current: {
        hold: 0.46,
        "cut-025": 0.37,
        "cut-050-plus": 0.17
      },
      outcomeVolumes: {
        hold: "V₪ 6.8M",
        "cut-025": "V₪ 6.4M",
        "cut-050-plus": "V₪ 4.1M"
      },
      rulesLead: "שוק זה ייסגר לפי הכרזת הריבית של בנק ישראל ב-17 ביוני.",
      relatedMarkets: [
        {
          title: "הצמיחה ברבעון השני תרד מתחת ל-2%?",
          probability: "33%",
          probabilityClass: "text-neon-green",
          volumeLabel: "V₪ 4.1M",
          href: "/markets/q2-growth-below-2"
        },
        {
          title: "מחירי הדיור ימשיכו לעלות במאי-יוני?",
          probability: "58%",
          probabilityClass: "text-neon-blue",
          volumeLabel: "V₪ 6.0M",
          href: "/markets/housing-prices-up-may-june"
        },
        {
          title: "הפד יבצע הורדה לפני החלטת יוני של בנק ישראל?",
          probability: "21%",
          probabilityClass: "text-neon-orange",
          volumeLabel: "V₪ 4.9M",
          href: "/markets/fed-cut-before-june-boi"
        }
      ],
      timeline: [
        {
          title: "פתיחת השוק",
          time: "29 אפר' 2026 · 14:12",
          dotClass: "bg-success",
          titleClass: "text-white",
          timeClass: "text-slate-400"
        },
        {
          title: "סגירת השוק",
          time: "17 יונ' 2026 · 13:59",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        },
        {
          title: "ביצוע תשלום",
          time: "17 יונ' 2026 · 14:09",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        }
      ],
      timeframes: {
        hour: [
          createPoint("10:30", "17 יונ' · 10:30", 0.5, 0.33),
          createPoint("10:40", "17 יונ' · 10:40", 0.495, 0.335),
          createPoint("10:50", "17 יונ' · 10:50", 0.49, 0.34),
          createPoint("11:00", "17 יונ' · 11:00", 0.48, 0.35),
          createPoint("11:10", "17 יונ' · 11:10", 0.47, 0.36),
          createPoint("11:20", "17 יונ' · 11:20", 0.46, 0.37),
          createPoint("11:30", "17 יונ' · 11:30", 0.46, 0.37)
        ],
        day: [
          createPoint("08:00", "17 יונ' · 08:00", 0.58, 0.27),
          createPoint("08:45", "17 יונ' · 08:45", 0.56, 0.29),
          createPoint("09:30", "17 יונ' · 09:30", 0.54, 0.31),
          createPoint("10:15", "17 יונ' · 10:15", 0.52, 0.33),
          createPoint("11:00", "17 יונ' · 11:00", 0.48, 0.35),
          createPoint("11:30", "17 יונ' · 11:30", 0.46, 0.37)
        ],
        month: [
          createPoint("30.04", "30 אפר' 2026", 0.61, 0.31),
          createPoint("10.05", "10 מאי 2026", 0.58, 0.31),
          createPoint("20.05", "20 מאי 2026", 0.54, 0.32),
          createPoint("30.05", "30 מאי 2026", 0.51, 0.34),
          createPoint("10.06", "10 יונ' 2026", 0.48, 0.35),
          createPoint("17.06", "17 יונ' 2026", 0.46, 0.37)
        ],
        all: [
          createPoint("אפר'", "אפריל 2026", 0.61, 0.31),
          createPoint("תח' מאי", "תחילת מאי 2026", 0.57, 0.31),
          createPoint("סוף מאי", "סוף מאי 2026", 0.51, 0.34),
          createPoint("אמצע יונ'", "אמצע יוני 2026", 0.46, 0.37)
        ]
      }
    }
  },
  "next-prime-minister": {
    context: NEXT_PRIME_MINISTER_CONTEXT,
    snapshot: {
      updatedLabel: "24 מרץ 2026 · 09:30",
      marketStateVersion: 0,
      volumeLabel: "V₪ 0",
      closeLabel: "22 ביוני",
      current: {
        "option-a": 0.25,
        "option-b": 0.25,
        "option-c": 0.25,
        "option-d": 0.25
      },
      outcomeVolumes: {
        "option-a": "V₪ 0",
        "option-b": "V₪ 0",
        "option-c": "V₪ 0",
        "option-d": "V₪ 0"
      },
      rulesLead:
        "השוק ייסגר עם קבלת תוצאה רשמית על מי יושבע בפועל לראשות הממשלה הבאה בישראל.",
      relatedMarkets: [],
      timeline: [
        {
          title: "פתיחת השוק",
          time: "23 מרץ 2026 · 09:00",
          dotClass: "bg-success",
          titleClass: "text-white",
          timeClass: "text-slate-400"
        },
        {
          title: "סגירת השוק",
          time: "22 יונ' 2026 · 20:00",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        },
        {
          title: "ביצוע תשלום",
          time: "לאחר הכרעה רשמית",
          dotClass: "bg-slate-600",
          titleClass: "text-slate-300",
          timeClass: "text-slate-500"
        }
      ],
      timeframes: {
        hour: [
          createFourWayPoint("08:30", "24 מרץ · 08:30", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("09:00", "24 מרץ · 09:00", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("09:30", "24 מרץ · 09:30", 0.25, 0.25, 0.25, 0.25)
        ],
        day: [
          createFourWayPoint("23.03", "23 מרץ 2026", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("24.03", "24 מרץ 2026", 0.25, 0.25, 0.25, 0.25)
        ],
        month: [
          createFourWayPoint("מרץ", "מרץ 2026", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("אפר'", "אפריל 2026", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("מאי", "מאי 2026", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("יונ'", "יוני 2026", 0.25, 0.25, 0.25, 0.25)
        ],
        all: [
          createFourWayPoint("השקה", "פתיחת שוק", 0.25, 0.25, 0.25, 0.25),
          createFourWayPoint("כעת", "כעת", 0.25, 0.25, 0.25, 0.25)
        ]
      }
    }
  }
};
