import type {
  MarketForm,
  ProposedOutcome,
  SensitivityLevel,
  SignalEnrichment,
  SignalTopicKind,
  SourceClass
} from "./contracts";
import {
  buildBoiRateDecisionTemplate,
  buildEcbRateDecisionTemplate,
  buildFedRateDecisionTemplate,
  buildSportsMatchWinnerTemplate,
  buildSportsRegulationThreeWayTemplate
} from "./planned-event-templates";
import { hasCutoffPassed } from "./market-cutoff-labels";
import {
  buildSignalText,
  inferCategory,
  isPoliticalOrSecurityPerson,
  normalizeCategory
} from "./signal-category-inference";
import {
  extractVsSides,
  hasCompetitionGrounding,
  inferSportsGrounding,
  inferSportsRecurringTemplateId,
  titled
} from "./signal-sports-grounding";
import { compactWhitespace, slugify } from "./text";

type SignalEnrichmentInput = {
  sourceId: string;
  sourceClass: SourceClass;
  category: string;
  title: string;
  summary: string;
  whyNow: string;
  observedAt: string;
  keyEntities?: string[];
  notes?: string[];
  tags?: string[];
  question?: string;
  marketForm?: MarketForm;
  proposedOutcomes?: ProposedOutcome[];
};

function hasProposalShape(input: SignalEnrichmentInput): boolean {
  return Boolean(input.question?.trim() && input.marketForm && input.proposedOutcomes && input.proposedOutcomes.length > 0);
}

function inferTopicKind(input: SignalEnrichmentInput, text: string, inferredCategory: string): SignalTopicKind {
  if (hasProposalShape(input)) {
    return "market-shaped";
  }

  if (input.sourceId === "src_home_front_command") {
    return text.includes("policy") ? "policy-update" : "public-safety-alert";
  }

  if (input.sourceId === "src_iaa_notifications") {
    return "infrastructure-disruption";
  }

  if (inferredCategory === "economy") {
    if (/\binterest rate\b/i.test(text) || /ריבית/u.test(text)) {
      return "scheduled-decision";
    }

    return "measurable-indicator";
  }

  if (inferredCategory === "sports") {
    return "team-or-competition-buzz";
  }

  if (inferredCategory === "science") {
    return /earthquake|quake|cyclone|storm|flood|volcano|wildfire|רעידת אדמה|שיטפון|סערה|שריפה/u.test(text)
      ? "public-safety-alert"
      : "measurable-indicator";
  }

  if (inferredCategory === "culture" && (/\beurovision\b/i.test(text) || /אירוויזיון/u.test(text))) {
    return "winner-race";
  }

  if ((inferredCategory === "security" || inferredCategory === "politics") && isPoliticalOrSecurityPerson(text)) {
    return "person-buzz";
  }

  if (inferredCategory === "security") {
    return "public-safety-alert";
  }

  if (inferredCategory === "travel") {
    return "infrastructure-disruption";
  }

  if (inferredCategory === "politics") {
    return /election|בחירות/u.test(text) ? "winner-race" : "policy-update";
  }

  const titleWords = compactWhitespace(input.title).split(/\s+/).filter(Boolean);

  if (titleWords.length <= 3) {
    return "person-buzz";
  }

  return "general-attention";
}

function extractYear(text: string): string | undefined {
  const match = text.match(/\b(20\d{2})\b/);
  return match?.[1];
}

function extractExplicitDateLabel(text: string): string | undefined {
  const match = text.match(/\b([a-z]+ \d{1,2}, 20\d{2})(?: at (\d{1,2}:\d{2}))?/i);

  if (!match?.[1]) {
    return undefined;
  }

  return match[2] ? `${titleCaseDate(match[1])} at ${match[2]}` : titleCaseDate(match[1]);
}

function titleCaseDate(value: string): string {
  return value.replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
}

function shortDateLabel(value: string): string {
  const parsed = new Date(`${value} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC"
  });
}

function extractDraftCutoffLabel(
  draft: Omit<
    SignalEnrichment,
    "sourceCategory" | "inferredCategory" | "topicKind" | "marketability" | "inferenceNotes"
  >
): string | undefined {
  const groundedEventDate = draft.draftAmbiguityNotes
    ?.map((note) => note.match(/grounding: event-date=(?:observed-trend-window:)?(.+)$/i)?.[1]?.trim())
    .find((value): value is string => Boolean(value));

  if (groundedEventDate) {
    return groundedEventDate;
  }

  const candidateTexts = [draft.draftSuggestedCloseShape, draft.draftQuestion].filter((value): value is string => Boolean(value));
  const datedPhrase = candidateTexts
    .map((text) => text.match(/\b(?:before|beyond|after|on)\s+([a-z]+ \d{1,2}, 20\d{2}(?: at \d{1,2}:\d{2})?)/i)?.[1]?.trim())
    .find((value): value is string => Boolean(value));

  return datedPhrase;
}

function extractUntilDeadline(text: string): string | undefined {
  const match = text.match(
    /until\s+(?:(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday),?\s+)?([a-z]+ \d{1,2}, 20\d{2})(?:,?\s+at\s+(\d{1,2}:\d{2}))?/i
  );

  if (!match?.[1]) {
    return undefined;
  }

  return match[2] ? `${titleCaseDate(match[1])} at ${match[2]}` : titleCaseDate(match[1]);
}

function extractAsOfDate(text: string): string | undefined {
  const match = text.match(/as of\s+([a-z]+ \d{1,2}, 20\d{2})/i);
  return match?.[1] ? titleCaseDate(match[1]) : undefined;
}

function isResolvedBankOfIsraelDecisionText(text: string): boolean {
  return (
    (/\b(decides?|decided)\b/i.test(text) && /\binterest rate\b/i.test(text)) ||
    /\bleave the interest rate unchanged\b/i.test(text) ||
    /\bleft the interest rate unchanged\b/i.test(text) ||
    /\braised the interest rate\b/i.test(text) ||
    /\blowered the interest rate\b/i.test(text) ||
    /\bincreased the interest rate\b/i.test(text) ||
    /\breduced the interest rate\b/i.test(text)
  );
}

function hasPlannedEventAnchor(input: SignalEnrichmentInput): boolean {
  return [...(input.tags ?? []), ...(input.notes ?? [])].some(
    (value) =>
      value === "planned" ||
      value === "planned-event" ||
      value === "intake-lane=planned" ||
      value === "intake-lane=planned-event"
  );
}

function yesNoOutcomes(): ProposedOutcome[] {
  return [
    { label: "Yes", kind: "binary-side" },
    { label: "No", kind: "binary-side" }
  ];
}

function buildDraft(input: SignalEnrichmentInput, text: string, inferredCategory: string): Omit<
  SignalEnrichment,
  "sourceCategory" | "inferredCategory" | "topicKind" | "marketability" | "inferenceNotes"
> {
  if (
    inferredCategory === "economy" &&
    (/\bbank of israel\b/i.test(text) || /בנק ישראל/u.test(text)) &&
    (/\binterest rate\b/i.test(text) || /ריבית/u.test(text))
  ) {
    const explicitDecisionDate = extractExplicitDateLabel(text);

    if (isResolvedBankOfIsraelDecisionText(text)) {
      return {
        draftLineageHint: "boi_rate_decisions"
      };
    }

    if (!explicitDecisionDate || (!hasPlannedEventAnchor(input) && input.sourceClass !== "authority")) {
      return {
        draftLineageHint: "boi_rate_decisions"
      };
    }

    const recurringTemplate = buildBoiRateDecisionTemplate(explicitDecisionDate);

    return {
      draftRecurringTemplateId: recurringTemplate.recurringTemplateId,
      draftLineageHint: recurringTemplate.lineageHint,
      draftQuestion: recurringTemplate.question,
      draftMarketAngle: recurringTemplate.marketAngle,
      draftMarketForm: recurringTemplate.marketForm,
      draftOutcomes: recurringTemplate.proposedOutcomes,
      draftMarketWorthiness: recurringTemplate.marketWorthiness,
      draftResolutionFeasibility: recurringTemplate.resolutionFeasibility,
      draftSuggestedCloseShape: recurringTemplate.suggestedCloseShape,
      draftSuggestedResolutionAnchor: recurringTemplate.suggestedResolutionAnchor,
      draftAmbiguityNotes: recurringTemplate.ambiguityNotes
    };
  }

  if (
    inferredCategory === "economy" &&
    input.sourceId === "src_federal_reserve_rss" &&
    /\b(federal reserve|fed|fomc)\b/i.test(text) &&
    /\b(rate|interest rate|target range)\b/i.test(text)
  ) {
    const explicitDecisionDate = extractExplicitDateLabel(text);

    if (!explicitDecisionDate || (!hasPlannedEventAnchor(input) && input.sourceClass !== "authority")) {
      return {
        draftLineageHint: "fed_rate_decisions"
      };
    }

    const recurringTemplate = buildFedRateDecisionTemplate(explicitDecisionDate);

    return {
      draftRecurringTemplateId: recurringTemplate.recurringTemplateId,
      draftLineageHint: recurringTemplate.lineageHint,
      draftQuestion: recurringTemplate.question,
      draftMarketAngle: recurringTemplate.marketAngle,
      draftMarketForm: recurringTemplate.marketForm,
      draftOutcomes: recurringTemplate.proposedOutcomes,
      draftMarketWorthiness: recurringTemplate.marketWorthiness,
      draftResolutionFeasibility: recurringTemplate.resolutionFeasibility,
      draftSuggestedCloseShape: recurringTemplate.suggestedCloseShape,
      draftSuggestedResolutionAnchor: recurringTemplate.suggestedResolutionAnchor,
      draftAmbiguityNotes: recurringTemplate.ambiguityNotes
    };
  }

  if (
    inferredCategory === "economy" &&
    input.sourceId === "src_ecb_rss" &&
    /\b(ecb|european central bank)\b/i.test(text) &&
    /\b(rate|interest rate|deposit facility)\b/i.test(text)
  ) {
    const explicitDecisionDate = extractExplicitDateLabel(text);

    if (!explicitDecisionDate || (!hasPlannedEventAnchor(input) && input.sourceClass !== "authority")) {
      return {
        draftLineageHint: "ecb_rate_decisions"
      };
    }

    const recurringTemplate = buildEcbRateDecisionTemplate(explicitDecisionDate);

    return {
      draftRecurringTemplateId: recurringTemplate.recurringTemplateId,
      draftLineageHint: recurringTemplate.lineageHint,
      draftQuestion: recurringTemplate.question,
      draftMarketAngle: recurringTemplate.marketAngle,
      draftMarketForm: recurringTemplate.marketForm,
      draftOutcomes: recurringTemplate.proposedOutcomes,
      draftMarketWorthiness: recurringTemplate.marketWorthiness,
      draftResolutionFeasibility: recurringTemplate.resolutionFeasibility,
      draftSuggestedCloseShape: recurringTemplate.suggestedCloseShape,
      draftSuggestedResolutionAnchor: recurringTemplate.suggestedResolutionAnchor,
      draftAmbiguityNotes: recurringTemplate.ambiguityNotes
    };
  }

  if (
    inferredCategory === "culture" &&
    (/\beurovision\b/i.test(text) || /אירוויזיון/u.test(text)) &&
    (/\bisrael\b/i.test(text) || /ישראל/u.test(text))
  ) {
    const year = extractYear(text);

    if (year) {
      return {
        draftQuestion: `Will Israel win Eurovision ${year}?`,
        draftMarketAngle: "Local-interest binary collapse for a noisy winner-race signal.",
        draftMarketForm: "binary",
        draftOutcomes: yesNoOutcomes(),
        draftMarketWorthiness: "Eurovision attention can become a clean local-interest binary if the year and settlement anchor are explicit.",
        draftResolutionFeasibility: "Official Eurovision final result can settle the question.",
        draftSuggestedResolutionAnchor: "Official Eurovision final scoreboard.",
        draftSensitivityLevel: "elevated"
      };
    }
  }

  if (inferredCategory === "sports") {
    const grounding = inferSportsGrounding(input, text);
    const sides = grounding.canonicalSides ?? extractVsSides(input.title);

    if (sides) {
      const [left, right] = sides.map(titled) as [string, string];
      const recurringSportsTemplateId = inferSportsRecurringTemplateId(grounding.coverageContextText);

      if (!recurringSportsTemplateId) {
        return {
          draftLineageHint: `sports_match_${slugify([left, right].sort().join("_vs_"))}`
        };
      }

      if (!grounding.matchDate || !grounding.hasFixtureContext) {
        return {
          draftLineageHint: `sports_match_${slugify([left, right].sort().join("_vs_"))}`
        };
      }

      if (
        recurringSportsTemplateId === "sports-regulation-3way-v1" &&
        !hasCompetitionGrounding(grounding.coverageContextText) &&
        !grounding.competitionLabel &&
        !grounding.hasFootballCoverageContext
      ) {
        return {
          draftLineageHint: `sports_match_${slugify([left, right].sort().join("_vs_"))}`
        };
      }

      const questionDate = grounding.matchDate ? ` on ${grounding.matchDate}` : "";
      const sortedSidesSlug = slugify([left, right].sort().join("_vs_"));
      const clusterDateSlug = slugify(grounding.matchDate ?? input.observedAt.slice(0, 10));
      const competitionSuffix = grounding.competitionLabel ? ` in ${grounding.competitionLabel}` : "";
      const resolutionAnchor = grounding.competitionLabel
        ? `Official ${grounding.competitionLabel} match result.`
        : "Official league or event result.";
      const dateGroundingNote = grounding.hasExplicitMatchDate
        ? undefined
        : "Event date inferred from trend timing and fixture-page context; verify exact date before publish.";
      const fetchNeedNotes = [
        ...grounding.fetchNeeds.map((need) => `fetch-needed=${need}`),
        ...(recurringSportsTemplateId === "sports-regulation-3way-v1"
          ? ["fetch-needed=regulation-settlement-rule"]
          : ["fetch-needed=overtime-settlement-rule"])
      ];
      const shortDate = grounding.matchDate ? shortDateLabel(grounding.matchDate) : undefined;
      const titleParts = [grounding.competitionLabel, shortDate].filter((value): value is string => Boolean(value));
      const compactTitle = titleParts.length > 0 ? `${left} vs ${right} (${titleParts.join(", ")})` : `${left} vs ${right}`;
      const recurringTemplate =
        recurringSportsTemplateId === "sports-regulation-3way-v1"
          ? buildSportsRegulationThreeWayTemplate({
              leftLabel: left,
              rightLabel: right,
              displayTitle: compactTitle,
              resolutionAnchor
            })
          : buildSportsMatchWinnerTemplate({
              leftLabel: left,
              rightLabel: right,
              displayTitle: compactTitle,
              resolutionAnchor
            });

      return {
        draftRecurringTemplateId: recurringTemplate.recurringTemplateId,
        draftClusterHint: `sports_match_${clusterDateSlug}_${sortedSidesSlug}`,
        draftLineageHint: `sports_match_${sortedSidesSlug}`,
        draftQuestion: recurringTemplate.question,
        draftMarketAngle: `${recurringTemplate.marketAngle}${competitionSuffix}${questionDate}.`,
        draftMarketForm: recurringTemplate.marketForm,
        draftOutcomes: recurringTemplate.proposedOutcomes,
        draftMarketWorthiness: recurringTemplate.marketWorthiness,
        draftResolutionFeasibility: recurringTemplate.resolutionFeasibility,
        draftSuggestedCloseShape: `Close before the scheduled matchup on ${grounding.matchDate}.`,
        draftSuggestedResolutionAnchor: recurringTemplate.suggestedResolutionAnchor,
        draftAmbiguityNotes:
          recurringSportsTemplateId === "sports-regulation-3way-v1"
            ? [
                "Needs human check for exact competition/date and explicit regulation-time settlement wording.",
                ...(dateGroundingNote ? [dateGroundingNote] : []),
                ...fetchNeedNotes,
                ...grounding.evidence.map((entry) => `grounding: ${entry}`)
              ]
            : [
                "Needs human check for event date, league, and whether overtime rules matter.",
                ...(dateGroundingNote ? [dateGroundingNote] : []),
                ...fetchNeedNotes,
                ...grounding.evidence.map((entry) => `grounding: ${entry}`)
              ]
      };
    }
  }

  if (input.sourceId === "src_home_front_command" && /defensive policy/i.test(text)) {
    const deadline = extractUntilDeadline(text);

    if (deadline) {
      return {
        draftQuestion: `Will Home Front Command extend the current defensive policy beyond ${deadline}?`,
        draftMarketAngle: "Official Home Front policy-window follow-up.",
        draftMarketForm: "binary",
        draftOutcomes: yesNoOutcomes(),
        draftMarketWorthiness: "Official policy window is bounded and has a clear follow-up trigger.",
        draftResolutionFeasibility: "Home Front Command follow-up notice should settle whether the policy was extended.",
        draftSuggestedCloseShape: `Close before ${deadline}.`,
        draftSuggestedResolutionAnchor: "Home Front Command official follow-up notice.",
        draftSensitivityLevel: "elevated",
        draftAmbiguityNotes: ["Security/public-safety framing needs careful human review before publish."],
        draftRiskFlags: ["public-safety-sensitive"]
      };
    }
  }

  if (input.sourceId === "src_iaa_notifications" && /resumption|resume|reopen|reopened/i.test(text)) {
    const asOfDate = extractAsOfDate(text);

    if (!asOfDate) {
      return {};
    }

    const topicLabel = input.title.replace(/^resumption of\s+/i, "").replace(/\s+at ben gurion airport$/i, "");

    return {
      draftQuestion: `Will ${topicLabel} remain available at Ben Gurion Airport after ${asOfDate}?`,
      draftMarketAngle: "Official IAA operational-resumption follow-up.",
      draftMarketForm: "binary",
      draftOutcomes: yesNoOutcomes(),
      draftMarketWorthiness: "Official airport operational changes can become reviewable if the service/action is clear.",
      draftResolutionFeasibility: "IAA follow-up notices can settle whether the operational resumption remained in effect.",
      draftSuggestedResolutionAnchor: "Israel Airports Authority official follow-up notice.",
      draftSensitivityLevel: "normal",
      draftAmbiguityNotes: ["Needs human check that the service/action wording is not too operationally narrow."]
    };
  }

  return {};
}

function inferMarketability(
  input: SignalEnrichmentInput,
  inferredCategory: string,
  topicKind: SignalTopicKind,
  hasDraft: boolean
): SignalEnrichment["marketability"] {
  if (hasProposalShape(input)) {
    return "already-shaped";
  }

  if (hasDraft) {
    return "draft-ready";
  }

  if (input.sourceId === "src_home_front_command" || input.sourceId === "src_iaa_notifications") {
    return "follow-up-needed";
  }

  if (["economy", "politics", "sports", "culture", "security", "travel", "science"].includes(inferredCategory)) {
    if (topicKind === "person-buzz") {
      return inferredCategory === "politics" || inferredCategory === "security" ? "follow-up-needed" : "watch-only";
    }

    if (inferredCategory === "sports" && / vs /i.test(input.title) && !hasDraft) {
      return "follow-up-needed";
    }

    return "follow-up-needed";
  }

  return "watch-only";
}

export function enrichSignal(input: SignalEnrichmentInput): SignalEnrichment {
  const sourceCategory = normalizeCategory(input.category);
  const text = buildSignalText(input);
  const categoryInference = inferCategory(input, text);
  const inferredCategory = categoryInference.category;
  const topicKind = inferTopicKind(input, text, inferredCategory);
  const draft = buildDraft(input, text, inferredCategory);
  const draftCutoffLabel = extractDraftCutoffLabel(draft);
  const draftExpired = Boolean(draftCutoffLabel) && hasCutoffPassed(draftCutoffLabel!, new Date(input.observedAt));
  const usableDraft = draftExpired ? {} : draft;
  const marketability = inferMarketability(input, inferredCategory, topicKind, Boolean(usableDraft.draftQuestion));
  const inferenceNotes = [
    ...(categoryInference.note ? [categoryInference.note] : []),
    ...(hasProposalShape(input) ? ["Signal already carries explicit market shape."] : []),
    ...(usableDraft.draftQuestion ? [`Draft market shape inferred for ${topicKind}.`] : []),
    ...(draftExpired ? ["Draft window already passed relative to signal timing; do not propose this event."] : []),
    ...(marketability === "follow-up-needed" ? ["Signal looks relevant but still needs shaping before proposal."] : []),
    ...(marketability === "watch-only" ? ["Signal is worth tracking but not yet marketable."] : [])
  ];

  return {
    sourceCategory,
    inferredCategory,
    topicKind,
    marketability,
    inferenceNotes,
    ...usableDraft
  };
}
