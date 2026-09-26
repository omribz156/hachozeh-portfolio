import type { ManualSeerSignal } from "./contracts";
import { getPlannedEventWarmupPolicy, isWithinUpcomingHorizon } from "./planned-event-family-policy";
import { buildBoiRateDecisionTemplate } from "./planned-event-templates";
import { fetchSourceText, SEER_HEARTBEAT_FETCH_OPTIONS } from "./source-fetch-client";
import {
  formatHebrewFullDateFromIso,
  isWithinLookback,
  titleCaseDate,
  toIsoDateFromDayMonthYear,
  toMonthDayYearLabelFromDayMonthYear,
  toSummary
} from "./source-text-utils";
import { compactWhitespace, decodeHtmlEntities, slugify, stripHtmlTags } from "./text";

export const BANK_OF_ISRAEL_SOURCE_ID = "src_boi_announcements";
export const BANK_OF_ISRAEL_PRESS_RELEASES_URL =
  "https://www.boi.org.il/en/communication-and-publications/press-releases/";
export const BANK_OF_ISRAEL_RATE_DATES_URL =
  "https://www.boi.org.il/en/economic-roles/monetary-policy/interest-rate-announcement-dates-2025-2026/";

type BankOfIsraelPressReleaseItem = {
  id: string;
  title: string;
  publishedAt: string;
  sourceRef: string;
  subjects: string[];
};

type BankOfIsraelScheduledDecisionDate = {
  publicationDateIso: string;
  publicationDateLabel: string;
  sourceRef: string;
};

function isResolvedBankOfIsraelDecisionText(text: string): boolean {
  const normalized = compactWhitespace(text).toLowerCase();

  return (
    (/\b(decides?|decided)\b/.test(normalized) && /\binterest rate\b/.test(normalized)) ||
    /\bleave the interest rate unchanged\b/.test(normalized) ||
    /\bleft the interest rate unchanged\b/.test(normalized) ||
    /\braised the interest rate\b/.test(normalized) ||
    /\blowered the interest rate\b/.test(normalized) ||
    /\bincreased the interest rate\b/.test(normalized) ||
    /\breduced the interest rate\b/.test(normalized)
  );
}

function isForwardLookingBankOfIsraelScheduleText(text: string): boolean {
  const normalized = compactWhitespace(text).toLowerCase();

  return (
    /\b(publication dates|schedule|calendar|upcoming|next decision|next meeting|will announce|to be announced|meeting dates)\b/.test(
      normalized
    ) ||
    /מועדי/u.test(normalized) ||
    /לוח/u.test(normalized) ||
    /צפוי/u.test(normalized) ||
    /יתפרסם/u.test(normalized)
  );
}

function extractBankOfIsraelScheduledDecisionDate(text: string): string | undefined {
  const match = compactWhitespace(text).match(/\b([a-z]+ \d{1,2}, 20\d{2})\b/i);
  return match?.[1] ? titleCaseDate(match[1]) : undefined;
}

export function parseBankOfIsraelPressReleasesHtml(html: string): BankOfIsraelPressReleaseItem[] {
  return [
    ...html.matchAll(
      /<a href="([^"]+)" title="([^"]+)"[\s\S]*?<div class="date">([^<]+)<\/div>[\s\S]*?(?:<div class="subjects[\s\S]*?<ul[^>]*>([\s\S]*?)<\/ul>[\s\S]*?)?<div class="spoiler[^>]*>([\s\S]*?)<\/div>/gi
    )
  ]
    .map((match) => {
      const subjectsBlock = match[4] ?? "";
      const subjects = [...subjectsBlock.matchAll(/<li>([\s\S]*?)<\/li>/gi)]
        .map((subjectMatch) =>
          compactWhitespace(stripHtmlTags(decodeHtmlEntities(subjectMatch[1] ?? "")))
        )
        .filter((subject) => subject.length > 0);
      const relativeRef = decodeHtmlEntities(match[1] ?? "").trim();
      const sourceRef = relativeRef.startsWith("http")
        ? relativeRef
        : `https://www.boi.org.il${relativeRef}`;
      const title = compactWhitespace(
        stripHtmlTags(decodeHtmlEntities(match[5] ?? match[2] ?? ""))
      );
      const publishedAt = toIsoDateFromDayMonthYear(match[3] ?? "");

      return {
        id: slugify(relativeRef || `${title}_${publishedAt}`),
        title,
        publishedAt,
        sourceRef,
        subjects
      };
    })
    .filter(
      (item) =>
        item.title.length > 0 && item.publishedAt.length > 0 && item.sourceRef.length > 0
    );
}

export function parseBankOfIsraelRateAnnouncementDatesHtml(
  html: string,
  sourceRef: string = BANK_OF_ISRAEL_RATE_DATES_URL
): BankOfIsraelScheduledDecisionDate[] {
  const yearBlockMatch = html.match(
    /<h2[^>]*>\s*2026 Interest rate announcement dates\s*<\/h2>[\s\S]*?<table[\s\S]*?<\/table>/i
  );
  const yearBlock = yearBlockMatch?.[0] ?? html;
  const rows = [...yearBlock.matchAll(/<tr>([\s\S]*?)<\/tr>/gi)];
  const scheduledDates = rows
    .slice(1)
    .map((row) => {
      const cells = [...row[1].matchAll(/<td[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/gi)]
        .map((cellMatch) => compactWhitespace(stripHtmlTags(decodeHtmlEntities(cellMatch[1] ?? ""))))
        .filter((value) => value.length > 0);
      const publicationDateRaw = cells.at(-1);

      if (!publicationDateRaw) {
        return undefined;
      }

      const publicationDateIso = toIsoDateFromDayMonthYear(publicationDateRaw);
      const publicationDateLabel = toMonthDayYearLabelFromDayMonthYear(publicationDateRaw);

      if (!publicationDateLabel) {
        return undefined;
      }

      return {
        publicationDateIso,
        publicationDateLabel,
        sourceRef
      };
    })
    .filter((value): value is BankOfIsraelScheduledDecisionDate => Boolean(value));

  return scheduledDates;
}

function shouldKeepBankOfIsraelItem(item: BankOfIsraelPressReleaseItem): boolean {
  const title = item.title.toLowerCase();
  const subjects = item.subjects.map((subject) => subject.toLowerCase());
  const combinedText = `${item.title} ${item.subjects.join(" ")}`;

  const looksLikeRateSignal =
    subjects.some((subject) => subject.includes("interest rate")) ||
    /\binterest rate\b|\bmonetary committee\b|\bpolicy rate\b/.test(title);

  if (!looksLikeRateSignal) {
    return false;
  }

  if (isResolvedBankOfIsraelDecisionText(combinedText)) {
    return false;
  }

  return isForwardLookingBankOfIsraelScheduleText(combinedText);
}

function toBankOfIsraelManualSignals(
  items: BankOfIsraelPressReleaseItem[],
  generatedAt: string
): ManualSeerSignal[] {
  return items.map((item) => {
    const scheduledDecisionDate = extractBankOfIsraelScheduledDecisionDate(item.title);
    const recurringTemplate = scheduledDecisionDate
      ? buildBoiRateDecisionTemplate(scheduledDecisionDate)
      : undefined;
    const scheduleSummary = toSummary(
      "Bank of Israel press release.",
      item.subjects.length > 0 ? `Subjects: ${item.subjects.join(", ")}.` : "Official BOI release."
    );

    return {
      objectType: "manual_seer_signal",
      signalId: `msig_boi_${item.id}`,
      sourceId: BANK_OF_ISRAEL_SOURCE_ID,
      intakeLane: "planned",
      recurringTemplateId: recurringTemplate?.recurringTemplateId,
      title: item.title,
      summary: scheduleSummary,
      category: "economy",
      whyNow: `Bank of Israel published "${item.title}" at ${item.publishedAt}.`,
      observedAt: item.publishedAt,
      importedAt: generatedAt,
      sourceRef: item.sourceRef,
      sourceLabel: "Bank of Israel",
      clusterHint: scheduledDecisionDate
        ? `boi_rate_decision_${slugify(scheduledDecisionDate)}`
        : `bank_of_israel_${slugify(item.title)}`,
      lineageHint: recurringTemplate?.lineageHint ?? "boi_rate_decisions",
      keyEntities: ["Bank of Israel", "Monetary Committee", ...item.subjects],
      question: recurringTemplate?.question,
      marketAngle: recurringTemplate?.marketAngle,
      marketForm: recurringTemplate?.marketForm,
      proposedOutcomes: recurringTemplate?.proposedOutcomes,
      marketWorthiness: recurringTemplate?.marketWorthiness,
      resolutionFeasibility: recurringTemplate?.resolutionFeasibility,
      suggestedCloseShape: recurringTemplate?.suggestedCloseShape,
      suggestedResolutionAnchor:
        recurringTemplate?.suggestedResolutionAnchor ?? "הודעת הריבית הרשמית של בנק ישראל.",
      notes: [
        ...(item.subjects.length > 0 ? [`subjects=${item.subjects.join("|")}`] : []),
        ...(recurringTemplate?.ambiguityNotes ?? []),
        "intake-lane=planned"
      ],
      tags: ["heartbeat", "authority", "official", "bank-of-israel", "economy", "planned"]
    };
  });
}

function toBankOfIsraelScheduleManualSignal(
  item: BankOfIsraelScheduledDecisionDate,
  generatedAt: string
): ManualSeerSignal {
  const recurringTemplate = buildBoiRateDecisionTemplate(item.publicationDateLabel);
  const hebrewPublicationDateLabel = formatHebrewFullDateFromIso(item.publicationDateIso);

  return {
    objectType: "manual_seer_signal",
    signalId: `msig_boi_schedule_${slugify(item.publicationDateIso)}`,
    sourceId: BANK_OF_ISRAEL_SOURCE_ID,
    intakeLane: "planned",
    recurringTemplateId: recurringTemplate.recurringTemplateId,
    title: `לוח החלטות הריבית של בנק ישראל - ${hebrewPublicationDateLabel}`,
    summary: `הלוח הרשמי של בנק ישראל מציג את מועד פרסום החלטת הריבית הקרובה ל-${hebrewPublicationDateLabel} בשעה 16:00.`,
    category: "economy",
    whyNow: `החלטת הריבית הקרובה של בנק ישראל מתוכננת ל-${hebrewPublicationDateLabel}.`,
    observedAt: item.publicationDateIso,
    importedAt: generatedAt,
    sourceRef: item.sourceRef,
    sourceLabel: "בנק ישראל",
    clusterHint: `boi_rate_decision_${slugify(item.publicationDateLabel)}`,
    lineageHint: recurringTemplate.lineageHint,
    keyEntities: ["Bank of Israel", "Monetary Committee", hebrewPublicationDateLabel],
    question: recurringTemplate.question,
    marketAngle: recurringTemplate.marketAngle,
    marketForm: recurringTemplate.marketForm,
    proposedOutcomes: recurringTemplate.proposedOutcomes,
    marketWorthiness: recurringTemplate.marketWorthiness,
    resolutionFeasibility: recurringTemplate.resolutionFeasibility,
    suggestedCloseShape: recurringTemplate.suggestedCloseShape,
    suggestedResolutionAnchor: recurringTemplate.suggestedResolutionAnchor,
    notes: [
      ...recurringTemplate.ambiguityNotes,
      "grounding: source=boi-rate-announcement-dates",
      "intake-lane=planned"
    ],
    tags: ["heartbeat", "authority", "official", "bank-of-israel", "economy", "planned"]
  };
}

export async function fetchBankOfIsraelSignals(
  generatedAt: string,
  fetchImpl: typeof fetch = fetch
): Promise<ManualSeerSignal[]> {
  const warmupPolicy = getPlannedEventWarmupPolicy("boi-rate-decision-v1");
  const scheduleResponse = await fetchImpl(
    BANK_OF_ISRAEL_RATE_DATES_URL,
    SEER_HEARTBEAT_FETCH_OPTIONS
  );

  if (scheduleResponse.ok) {
    const scheduledDates = parseBankOfIsraelRateAnnouncementDatesHtml(await scheduleResponse.text())
      .filter((item) =>
        isWithinUpcomingHorizon(item.publicationDateIso, generatedAt, warmupPolicy.horizonDays)
      )
      .sort((left, right) => Date.parse(left.publicationDateIso) - Date.parse(right.publicationDateIso))
      .slice(0, warmupPolicy.maxUpcomingSiblings);

    if (scheduledDates.length > 0) {
      return scheduledDates.map((item) => toBankOfIsraelScheduleManualSignal(item, generatedAt));
    }
  }

  const html = await fetchSourceText(
    BANK_OF_ISRAEL_PRESS_RELEASES_URL,
    "Bank of Israel",
    fetchImpl
  );
  const items = parseBankOfIsraelPressReleasesHtml(html);
  const recentItems = items
    .filter((item) => isWithinLookback(item.publishedAt, generatedAt, 90))
    .filter(shouldKeepBankOfIsraelItem)
    .slice(0, 6);

  return toBankOfIsraelManualSignals(recentItems, generatedAt);
}
