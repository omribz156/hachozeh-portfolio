import type {
  ProposedOutcome,
  ReviewHandoffItem
} from "./contracts";
import { getSportsMarketFamilyPolicy } from "./planned-event-templates";

function extractFirstUrl(value: string | undefined): string | null {
  return value?.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function extractGroundingValue(item: ReviewHandoffItem, key: string): string | null {
  const prefix = `grounding: ${key}=`;
  const entries = [
    ...(item.topRisks ?? []),
    ...(item.reviewHints ?? []),
    ...(item.contract?.ambiguityPolicy?.split("|").map((entry) => entry.trim()) ?? [])
  ];
  const match = entries.find((entry) => entry.startsWith(prefix));

  return match?.slice(prefix.length).trim() || null;
}

function extractKeyedValue(item: ReviewHandoffItem, key: string): string | null {
  const prefix = `${key}=`;
  const entries = [
    ...(item.topRisks ?? []),
    ...(item.reviewHints ?? []),
    ...(item.contract?.ambiguityPolicy?.split("|").map((entry) => entry.trim()) ?? [])
  ];
  const match = entries.find((entry) => entry.startsWith(prefix));

  return match?.slice(prefix.length).trim() || null;
}

function toHebrewDateLabel(value: string): string {
  const isoMatch = value.match(/^(20\d{2})-(\d{2})-(\d{2})$/);
  const hebrewMonths = [
    "בינואר",
    "בפברואר",
    "במרץ",
    "באפריל",
    "במאי",
    "ביוני",
    "ביולי",
    "באוגוסט",
    "בספטמבר",
    "באוקטובר",
    "בנובמבר",
    "בדצמבר"
  ];

  if (isoMatch?.[1] && isoMatch[2] && isoMatch[3]) {
    const month = hebrewMonths[Number(isoMatch[2]) - 1];
    return month ? `${Number(isoMatch[3])} ${month} ${isoMatch[1]}` : value;
  }

  const match = value.match(/^([A-Za-z]+) (\d{1,2}), (20\d{2})$/);

  if (!match?.[1] || !match[2] || !match[3]) {
    return value;
  }

  const months: Record<string, string> = {
    january: "בינואר",
    february: "בפברואר",
    march: "במרץ",
    april: "באפריל",
    may: "במאי",
    june: "ביוני",
    july: "ביולי",
    august: "באוגוסט",
    september: "בספטמבר",
    october: "באוקטובר",
    november: "בנובמבר",
    december: "בדצמבר"
  };
  const month = months[match[1].toLowerCase()];

  return month ? `${Number(match[2])} ${month} ${match[3]}` : value;
}

function hasSourceId(item: ReviewHandoffItem, sourceId: string): boolean {
  return [
    ...(item.topSourceIds ?? []),
    ...(item.contract?.resolutionSource?.sourceIds ?? [])
  ].includes(sourceId);
}

function extractTemperatureThreshold(value: string): string | null {
  const match = value.match(/(\d+(?:\.\d+)?)\s*(?:°|מעלות|צלזיוס|c\b)/i);
  return match?.[1] ?? null;
}

function buildImsThresholdResolutionRule(item: ReviewHandoffItem, question: string): string | null {
  if (item.marketForm !== "threshold" || !hasSourceId(item, "src_ims_daily_observations")) {
    return null;
  }

  const threshold =
    extractTemperatureThreshold(item.contract?.resolutionRule ?? "") ??
    extractTemperatureThreshold(question);
  const date = toHebrewDateLabel(
    extractGroundingValue(item, "event-date") ??
      extractKeyedValue(item, "measurement-date-local") ??
      "תאריך השוק"
  );
  const station =
    extractGroundingValue(item, "station") ??
    extractKeyedValue(item, "station-name") ??
    "התחנה הרשמית שנקבעה בשוק";

  if (!threshold) {
    return null;
  }

  return `השוק מוכרע לפי ערך TDmax הרשמי של השירות המטאורולוגי בתחנת ${station} עבור ${date}: ${threshold}°C ומעלה = כן; פחות מ-${threshold}°C = לא.`;
}

function buildEurovisionResolutionRule(item: ReviewHandoffItem, question: string): string | null {
  if (!hasSourceId(item, "src_eurovision_official")) {
    return null;
  }

  const sourceUrl =
    extractFirstUrl(item.suggestedResolutionAnchor) ??
    extractFirstUrl(item.sourceRolePlan?.resolve?.[0]);
  const sourcePart = formatHebrewResolutionSource(sourceUrl, "אתר Eurovision הרשמי");
  const normalized = question.replace(/\s+/g, " ");

  if (item.marketForm === "multi-outcome" && /(?:מי\s+תזכה|מי\s+ינצח|winner|who\s+will\s+win)/iu.test(normalized)) {
    return [
      "השוק מוכרע לפי טבלת התוצאות הרשמית של גמר אירוויזיון 2026.",
      "התוצאה הזוכה היא המדינה שמדורגת במקום הראשון בדירוג הסופי הרשמי.",
      "הדירוג הסופי כולל את סך נקודות השופטים והקהל כפי שפורסם על ידי Eurovision.",
      "אם המקור הרשמי מפעיל שובר שוויון, משתמשים בדירוג הרשמי לאחר שובר השוויון.",
      sourcePart
    ].join(" ");
  }

  if (item.marketForm === "multi-outcome" && /(?:אחרונה|מקום\s+ה?אחרון|last place)/iu.test(normalized)) {
    return [
      "השוק מוכרע לפי טבלת התוצאות הרשמית של גמר אירוויזיון 2026.",
      "התוצאה הזוכה היא המדינה שמדורגת במקום האחרון בדירוג הסופי הרשמי של כל הפיינליסטיות.",
      "אם המקור הרשמי מפעיל שובר שוויון לדירוג הסופי, משתמשים בדירוג הרשמי לאחר שובר השוויון.",
      sourcePart
    ].join(" ");
  }

  if (item.marketForm !== "binary") {
    return null;
  }

  if (/ישראל/u.test(normalized) && /(?:טופ\s*(3|5|10)|top\s*(3|5|10))/iu.test(normalized)) {
    const rank = normalized.match(/(?:טופ\s*(3|5|10)|top\s*(3|5|10))/iu);
    const limit = rank?.[1] ?? rank?.[2] ?? "5";
    return [
      "השוק מוכרע לפי טבלת התוצאות הרשמית של גמר אירוויזיון 2026.",
      `אם ישראל מופיעה במקום 1 עד ${limit} בדירוג הסופי הרשמי, התוצאה היא כן; אחרת התוצאה היא לא.`,
      "הדירוג הסופי כולל את סך נקודות השופטים והקהל כפי שפורסם על ידי Eurovision.",
      sourcePart
    ].join(" ");
  }

  if (/ישראל/u.test(normalized) && /(?:תזכה|תנצח|לנצח|win)/iu.test(normalized) && /(?:הצבעת הקהל|קהל|televote|public vote)/iu.test(normalized)) {
    return [
      "השוק מוכרע לפי טבלת הניקוד הרשמית של גמר אירוויזיון 2026.",
      "אם ישראל מדורגת ראשונה בניקוד הקהל הרשמי, התוצאה היא כן; אחרת התוצאה היא לא.",
      "אם המקור הרשמי מפרסם נקודות בלבד בלי דירוג נפרד, ישראל נחשבת זוכה בהצבעת הקהל רק אם קיבלה את מספר נקודות הקהל הגבוה ביותר מבין כל הפיינליסטיות.",
      sourcePart
    ].join(" ");
  }

  if (/ישראל/u.test(normalized) && /(?:תזכה|תנצח|לנצח|win)/iu.test(normalized) && /(?:שופטים|jury)/iu.test(normalized)) {
    return [
      "השוק מוכרע לפי טבלת הניקוד הרשמית של גמר אירוויזיון 2026.",
      "אם ישראל מדורגת ראשונה בניקוד השופטים הרשמי, התוצאה היא כן; אחרת התוצאה היא לא.",
      "אם המקור הרשמי מפרסם נקודות בלבד בלי דירוג נפרד, ישראל נחשבת זוכה בהצבעת השופטים רק אם קיבלה את מספר נקודות השופטים הגבוה ביותר מבין כל הפיינליסטיות.",
      sourcePart
    ].join(" ");
  }

  if (/ישראל/u.test(normalized) && /(?:אחרונה|מקום\s+ה?אחרון|last place)/iu.test(normalized)) {
    return [
      "השוק מוכרע לפי טבלת התוצאות הרשמית של גמר אירוויזיון 2026.",
      "אם ישראל מדורגת אחרונה בדירוג הסופי הרשמי של כל הפיינליסטיות, התוצאה היא כן; אחרת התוצאה היא לא.",
      "אם המקור הרשמי מפעיל שובר שוויון לדירוג הסופי, משתמשים בדירוג הרשמי לאחר שובר השוויון.",
      sourcePart
    ].join(" ");
  }

  if (/ישראל/u.test(normalized) && /(?:תזכה|תנצח|לנצח|win)/iu.test(normalized)) {
    return [
      "השוק מוכרע לפי טבלת התוצאות הרשמית של גמר אירוויזיון 2026.",
      "אם ישראל מדורגת במקום הראשון בדירוג הסופי הרשמי, התוצאה היא כן; אחרת התוצאה היא לא.",
      "הדירוג הסופי כולל את סך נקודות השופטים והקהל כפי שפורסם על ידי Eurovision.",
      sourcePart
    ].join(" ");
  }

  return [
    `השוק מוכרע לפי התוצאה הרשמית של גמר אירוויזיון 2026 עבור "${question}".`,
    "אם טבלת התוצאות הרשמית אינה מאפשרת למפות את השאלה לאחת התוצאות הרשומות, השוק נשאר בהמתנה לבדיקת מפעיל.",
    sourcePart
  ].join(" ");
}

export function formatHebrewResolutionSource(sourceUrl: string | null | undefined, sourceLabel?: string | null): string {
  if (sourceUrl) {
    return `מקור ההכרעה: ${sourceUrl}`;
  }

  return sourceLabel ? `מקור ההכרעה: ${sourceLabel}.` : "";
}

export function buildResolutionRules(
  item: ReviewHandoffItem,
  overrides?: {
    question?: string;
    proposedOutcomes?: ProposedOutcome[];
    suggestedResolutionAnchor?: string;
  }
): string {
  const { recurringTemplateId, marketForm } = item;
  const contractResolutionRule = item.contract?.resolutionRule?.trim();
  const question = (overrides?.question ?? item.question).trim();
  const imsThresholdRule = buildImsThresholdResolutionRule(item, question);
  const eurovisionRule = buildEurovisionResolutionRule(item, question);

  if (imsThresholdRule) {
    return imsThresholdRule;
  }

  if (eurovisionRule) {
    return eurovisionRule;
  }

  if (recurringTemplateId === "sports-match-winner-v1" || recurringTemplateId === "sports-regulation-3way-v1") {
    const policy = getSportsMarketFamilyPolicy(recurringTemplateId);
    const resolutionAnchor = overrides?.suggestedResolutionAnchor ?? item.suggestedResolutionAnchor;
    const sourceUrl = extractFirstUrl(resolutionAnchor) ?? extractFirstUrl(item.sourceRolePlan?.resolve?.[0]);
    const sourceLabel = resolutionAnchor?.replace(/\s*https?:\/\/\S+.*/, "").replace(/[:.]\s*$/, "").trim();
    const namedEvent = question;
    const listedOutcomes = (overrides?.proposedOutcomes ?? item.proposedOutcomes)
      .map((outcome) => outcome.label.trim())
      .filter(Boolean)
      .join(" / ");

    return policy.settlementScope === "regulation-time"
      ? [
          `השוק מוכרע לפי התוצאה הרשמית הסופית עבור "${namedEvent}" כפי שהיא מופיעה במקור הרשמי.`,
          listedOutcomes ? `התוצאה הזוכה חייבת להיות אחת מהתוצאות הרשומות: ${listedOutcomes}.` : "",
          listedOutcomes.includes("תיקו") ? "אם המקור הרשמי מציג תיקו כתוצאה סופית, האפשרות תיקו זוכה." : "",
          formatHebrewResolutionSource(sourceUrl, sourceLabel)
        ]
          .filter(Boolean)
          .join(" ")
      : [
          `השוק מוכרע לפי המנצחת הרשמית בתוצאה הסופית עבור "${namedEvent}".`,
          listedOutcomes ? `התוצאה הזוכה חייבת להיות אחת מהתוצאות הרשומות: ${listedOutcomes}.` : "",
          formatHebrewResolutionSource(sourceUrl, sourceLabel)
        ]
          .filter(Boolean)
          .join(" ");
  }

  switch (recurringTemplateId) {
    case "boi-rate-decision-v1":
      const decisionDate = toHebrewDateLabel(extractGroundingValue(item, "event-date") ?? "מועד ההחלטה הרשמי");
      const sourceUrl = extractFirstUrl(item.suggestedResolutionAnchor) ?? extractFirstUrl(item.sourceRolePlan?.resolve?.[0]);
      return [
        `השוק מוכרע לפי הודעת הריבית הרשמית של בנק ישראל עבור החלטת ${decisionDate}.`,
        "משווים את הריבית שתפורסם בהחלטה לריבית בנק ישראל שהייתה בתוקף מיד לפני ההחלטה, ומיישבים לפי דלי השינוי המתאים בנקודות בסיס.",
        "אם השינוי אינו בדיוק אחד הדליים, הוא משויך לדלי הקרוב שמכסה אותו: ירידה של 0.50%+ / ירידה של 0.25% / ללא שינוי / עלייה של 0.25% / עלייה של 0.50%+.",
        "אם הפרסום הרשמי מתעכב או אינו חד-משמעי, השוק נשאר פתוח להכרעה עד לאימות רשמי.",
        formatHebrewResolutionSource(sourceUrl, "אתר בנק ישראל הרשמי")
      ].join(" ");
    case "fed-rate-decision-v1":
      return "Resolves to the official Federal Reserve rate announcement. Compare the announced decision with the immediately prior target rate and settle to the matching bps bucket.";
    case "ecb-rate-decision-v1":
      return "Resolves to the official ECB rate announcement. Compare the announced decision with the immediately prior policy rate and settle to the matching bps bucket.";
    case "knesset-dissolution-before-date-v1":
      return "מוכרע לפי הצבעה רשמית על פיזור הכנסת או פרסום רשמי על פיזור הכנסת לפני מועד הסגירה. אם לא היה פיזור רשמי עד המועד, התוצאה היא 'לא'.";
    default:
      if (contractResolutionRule) {
        return contractResolutionRule;
      }

      if (marketForm === "date-bucket" && isHormuzPortWatchDateBucket(item)) {
        return "מוכרע לפי נתוני IMF PortWatch עבור Strait of Hormuz. התוצאה היא הדלי המוקדם ביותר שבו פורסם ממוצע נע 7-יומי של transit calls / Arrivals of Ships בערך 60 או יותר. אם לא פורסם ערך כזה עד 31 ביולי 2026, התוצאה היא 'לא חזר לנורמה עד סוף יולי 2026'. תיקונים רטרואקטיביים בתוך חלון השוק נחשבים אם פורסמו לפני נתוני 31 ביולי 2026; תיקונים מאוחרים יותר לא נחשבים.";
      }

      if (marketForm === "date-bucket") {
        return "Resolves to the earliest listed date bucket that matches the event result reported by the stated resolution source. If none of the dated buckets occur and a fallback outcome is listed, that fallback wins. Exactly one listed outcome wins.";
      }

      return marketForm === "binary"
        ? "Resolves to the official result named by the stated resolution source."
        : "Resolves to the official final result named by the stated resolution source. Exactly one listed outcome wins.";
  }
}

function isHormuzPortWatchDateBucket(item: ReviewHandoffItem): boolean {
  const haystack = [
    item.candidateMarketId,
    item.lineageId,
    item.question,
    item.suggestedResolutionAnchor,
    ...(item.topSourceIds ?? []),
    ...(item.topSourceRefs ?? []),
    ...(item.sourceRolePlan?.wake ?? []),
    ...(item.sourceRolePlan?.ground ?? []),
    ...(item.sourceRolePlan?.resolve ?? [])
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return haystack.includes("hormuz") && haystack.includes("portwatch");
}

export function buildDelayPolicy(item: ReviewHandoffItem): string | undefined {
  if (item.recurringTemplateId === "sports-match-winner-v1" || item.recurringTemplateId === "sports-regulation-3way-v1") {
    return "אם המשחק נדחה לפני תחילתו, השוק נשאר בהמתנה עד עדכון זמן סגירה באישור מפעיל. אם המשחק התחיל ולאחר מכן הופסק ללא תוצאה רשמית סופית, השוק נשאר סגור וממתין להכרעה עד שהמקור הרשמי מפרסם תוצאה סופית.";
  }

  if (hasSourceId(item, "src_eurovision_official")) {
    return "אם פרסום התוצאות הרשמי מתעכב, חסר, או מתקן נתון לאחר השידור, השוק נשאר סגור וממתין לאימות מפעיל מול מקור Eurovision הרשמי לפני הכרעה.";
  }

  return undefined;
}

export function buildPayoutPolicy(): string {
  return "התשלום מתבצע רק לאחר פרסום תוצאה רשמית, אישור מפעיל, ועדכון השוק למצב נפתר. אין להסיק תשלום מזמן סגירת המסחר בלבד.";
}
