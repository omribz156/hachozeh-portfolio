import type {
  MarketForm,
  ProposedOutcome,
  RecurringEventTemplateId,
  SensitivityLevel,
  SportsRecurringTemplateId
} from "./contracts";

export type PlannedEventTemplateDraft = {
  recurringTemplateId: RecurringEventTemplateId;
  templateLabel: string;
  lineageHint: string;
  question: string;
  marketAngle: string;
  marketForm: MarketForm;
  proposedOutcomes: ProposedOutcome[];
  marketWorthiness: string;
  resolutionFeasibility: string;
  suggestedCloseShape: string;
  suggestedResolutionAnchor: string;
  ambiguityNotes: string[];
  sensitivityLevel?: SensitivityLevel;
};

const boiRateDecisionOutcomes: ProposedOutcome[] = [
  { label: "ירידה של 0.50%+", kind: "named-outcome" },
  { label: "ירידה של 0.25%", kind: "named-outcome" },
  { label: "ללא שינוי", kind: "named-outcome" },
  { label: "עלייה של 0.25%", kind: "named-outcome" },
  { label: "עלייה של 0.50%+", kind: "named-outcome" }
];

function extractMonthLabel(decisionDate: string): string {
  const match = decisionDate.match(/^([A-Za-z]+)\s+\d{1,2},\s+20\d{2}$/);
  return match?.[1] ?? decisionDate;
}

function extractHebrewMonthLabel(decisionDate: string): string {
  const parsed = new Date(`${decisionDate} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return extractMonthLabel(decisionDate);
  }

  return new Intl.DateTimeFormat("he-IL", {
    month: "long",
    timeZone: "UTC"
  }).format(parsed);
}

function extractHebrewFullDateLabel(value: string): string {
  const parsed = new Date(`${value} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("he-IL", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC"
  }).format(parsed);
}

type CentralBankTemplateOptions = {
  recurringTemplateId: RecurringEventTemplateId;
  templateLabel: string;
  lineageHint: string;
  institutionLabel: string;
  decisionDate: string;
  resolutionAnchor: string;
  publicationTimeLabel?: string;
};

type SportsMatchTemplateOptions = {
  recurringTemplateId: SportsRecurringTemplateId;
  leftLabel: string;
  rightLabel: string;
  displayTitle: string;
  resolutionAnchor: string;
};

export type SportsMarketFamilyPolicy = {
  recurringTemplateId: SportsRecurringTemplateId;
  templateLabel: string;
  marketAngle: string;
  marketWorthiness: string;
  resolutionFeasibility: string;
  drawPolicy: "not-allowed" | "regulation-only";
  settlementScope: "official-winner" | "regulation-time";
  commonSports: string[];
};

const sportsMarketFamilyPolicies: Record<SportsRecurringTemplateId, SportsMarketFamilyPolicy> = {
  "sports-match-winner-v1": {
    recurringTemplateId: "sports-match-winner-v1",
    templateLabel: "Sports winner matchup",
    marketAngle: "Explicit head-to-head matchup shaped into a clean winner market.",
    marketWorthiness:
      "Head-to-head sports matchups map cleanly to a simple winner market when both sides are explicit.",
    resolutionFeasibility: "Needs official league/event result before publish.",
    drawPolicy: "not-allowed",
    settlementScope: "official-winner",
    commonSports: ["basketball", "tennis", "cricket", "mma", "boxing", "esports"]
  },
  "sports-regulation-3way-v1": {
    recurringTemplateId: "sports-regulation-3way-v1",
    templateLabel: "Football regulation-time three-way matchup",
    marketAngle: "Football matchup shaped into regulation-time three-way buckets.",
    marketWorthiness:
      "Football matchups need regulation-time buckets that mirror common platform three-way market structure.",
    resolutionFeasibility: "Needs official competition result and regulation-time settlement rule before publish.",
    drawPolicy: "regulation-only",
    settlementScope: "regulation-time",
    commonSports: ["football", "soccer", "futsal"]
  }
};

export function getSportsMarketFamilyPolicy(templateId: SportsRecurringTemplateId): SportsMarketFamilyPolicy {
  return sportsMarketFamilyPolicies[templateId];
}

export function buildCentralBankRateDecisionTemplate({
  recurringTemplateId,
  templateLabel,
  lineageHint,
  institutionLabel,
  decisionDate,
  resolutionAnchor,
  publicationTimeLabel
}: CentralBankTemplateOptions): PlannedEventTemplateDraft {
  const monthLabel = extractMonthLabel(decisionDate);

  return {
    recurringTemplateId,
    templateLabel,
    lineageHint,
    question: `${institutionLabel} decision in ${monthLabel}?`,
    marketAngle: "Scheduled central-bank decision shaped into explicit basis-point change buckets.",
    marketForm: "binary",
    proposedOutcomes: boiRateDecisionOutcomes,
    marketWorthiness: "A scheduled rate decision with explicit bps buckets and a clear date anchor can become a clean planned-event economy market.",
    resolutionFeasibility: `Needs ${institutionLabel} official announcement before publish.`,
    suggestedCloseShape: publicationTimeLabel
      ? `Close before ${decisionDate} at ${publicationTimeLabel}.`
      : `Close before ${decisionDate}.`,
    suggestedResolutionAnchor: resolutionAnchor,
    ambiguityNotes: [
      `grounding: event-date=${decisionDate}`,
      ...(publicationTimeLabel ? [`grounding: publication-time=${publicationTimeLabel}`] : [])
    ]
  };
}

export function buildBoiRateDecisionTemplate(decisionDate: string): PlannedEventTemplateDraft {
  const baseTemplate = buildCentralBankRateDecisionTemplate({
    recurringTemplateId: "boi-rate-decision-v1",
    templateLabel: "Bank of Israel rate decision",
    lineageHint: "boi_rate_decisions",
    institutionLabel: "Bank of Israel",
    decisionDate,
    resolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל.",
    publicationTimeLabel: "16:00"
  });

  const monthLabel = extractHebrewMonthLabel(decisionDate);

  return {
    ...baseTemplate,
    question: `החלטת בנק ישראל ב${monthLabel}?`,
    proposedOutcomes: boiRateDecisionOutcomes,
    resolutionFeasibility: "דורש את הודעת הריבית הרשמית של בנק ישראל לפני פרסום.",
    suggestedResolutionAnchor: "הודעת הריבית הרשמית של בנק ישראל."
  };
}

export function buildFedRateDecisionTemplate(decisionDate: string): PlannedEventTemplateDraft {
  return buildCentralBankRateDecisionTemplate({
    recurringTemplateId: "fed-rate-decision-v1",
    templateLabel: "Federal Reserve rate decision",
    lineageHint: "fed_rate_decisions",
    institutionLabel: "Fed",
    decisionDate,
    resolutionAnchor: "Federal Reserve official rate announcement."
  });
}

export function buildEcbRateDecisionTemplate(decisionDate: string): PlannedEventTemplateDraft {
  return buildCentralBankRateDecisionTemplate({
    recurringTemplateId: "ecb-rate-decision-v1",
    templateLabel: "ECB rate decision",
    lineageHint: "ecb_rate_decisions",
    institutionLabel: "ECB",
    decisionDate,
    resolutionAnchor: "ECB official rate announcement."
  });
}

export function buildKnessetDissolutionBeforeDateTemplate(deadlineDate: string): PlannedEventTemplateDraft {
  const deadlineLabel = extractHebrewFullDateLabel(deadlineDate);

  return {
    recurringTemplateId: "knesset-dissolution-before-date-v1",
    templateLabel: "Knesset dissolution before date",
    lineageHint: "knesset_dissolution_2026",
    question: `האם הכנסת תתפזר עד ${deadlineLabel}?`,
    marketAngle: "Bounded political dissolution clock shaped into a clear binary market.",
    marketForm: "binary",
    proposedOutcomes: [
      { label: "כן", kind: "binary-side" },
      { label: "לא", kind: "binary-side" }
    ],
    marketWorthiness: "A bounded Knesset-dissolution deadline creates a clean local political binary with strong consumer relevance.",
    resolutionFeasibility: "Needs official Knesset dissolution vote/result or an official dissolution publication before publish.",
    suggestedCloseShape: `Close before ${deadlineDate} at 20:59.`,
    suggestedResolutionAnchor: "הצבעה רשמית בכנסת או פרסום רשמי על פיזור הכנסת.",
    ambiguityNotes: [`grounding: event-date=${deadlineDate}`],
    sensitivityLevel: "elevated"
  };
}

export function buildSportsMatchWinnerTemplate({
  leftLabel,
  rightLabel,
  displayTitle,
  resolutionAnchor
}: Omit<SportsMatchTemplateOptions, "recurringTemplateId">): PlannedEventTemplateDraft {
  const policy = getSportsMarketFamilyPolicy("sports-match-winner-v1");

  return {
    recurringTemplateId: policy.recurringTemplateId,
    templateLabel: policy.templateLabel,
    lineageHint: "",
    question: displayTitle,
    marketAngle: policy.marketAngle,
    marketForm: "multi-outcome",
    proposedOutcomes: [
      {
        label: leftLabel,
        kind: "named-outcome",
        notes: "Named-side bucket from the explicit matchup text."
      },
      {
        label: rightLabel,
        kind: "named-outcome",
        notes: "Named-side bucket from the explicit matchup text."
      }
    ],
    marketWorthiness: policy.marketWorthiness,
    resolutionFeasibility: policy.resolutionFeasibility,
    suggestedCloseShape: "",
    suggestedResolutionAnchor: resolutionAnchor,
    ambiguityNotes: []
  };
}

export function buildSportsRegulationThreeWayTemplate({
  leftLabel,
  rightLabel,
  displayTitle,
  resolutionAnchor
}: Omit<SportsMatchTemplateOptions, "recurringTemplateId">): PlannedEventTemplateDraft {
  const policy = getSportsMarketFamilyPolicy("sports-regulation-3way-v1");

  return {
    recurringTemplateId: policy.recurringTemplateId,
    templateLabel: policy.templateLabel,
    lineageHint: "",
    question: displayTitle,
    marketAngle: policy.marketAngle,
    marketForm: "multi-outcome",
    proposedOutcomes: [
      {
        label: leftLabel,
        kind: "named-outcome",
        notes: "Home/left side wins in regulation."
      },
      {
        label: "Draw",
        kind: "named-outcome",
        notes: "Match ends level in regulation."
      },
      {
        label: rightLabel,
        kind: "named-outcome",
        notes: "Away/right side wins in regulation."
      }
    ],
    marketWorthiness: policy.marketWorthiness,
    resolutionFeasibility: policy.resolutionFeasibility,
    suggestedCloseShape: "",
    suggestedResolutionAnchor: resolutionAnchor,
    ambiguityNotes: []
  };
}

export function describeRecurringTemplate(templateId: RecurringEventTemplateId): string {
  switch (templateId) {
    case "boi-rate-decision-v1":
      return "Recurring template: BOI rate decision v1.";
    case "fed-rate-decision-v1":
      return "Recurring template: Fed rate decision v1.";
    case "ecb-rate-decision-v1":
      return "Recurring template: ECB rate decision v1.";
    case "knesset-dissolution-before-date-v1":
      return "Recurring template: Knesset dissolution before date v1.";
    case "sports-match-winner-v1":
      return "Recurring template: sports match winner v1.";
    case "sports-regulation-3way-v1":
      return "Recurring template: sports regulation-time three-way v1.";
  }
}
