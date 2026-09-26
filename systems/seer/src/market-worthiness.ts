import type {
  ConfidenceLabel,
  DuplicateAssessment,
  MarketForm,
  MarketWorthinessDimension,
  MarketShapingTier,
  MarketWorthinessAssessment,
  PlatformShapeExample,
  ProposedOutcome,
  SensitivityLevel,
  WorthinessFailureReason
} from "./contracts";

type MarketWorthinessInput = {
  observedAt: string;
  signalCount: number;
  question?: string;
  marketAngle?: string;
  marketForm?: MarketForm;
  proposedOutcomes?: ProposedOutcome[];
  resolutionFeasibility?: string;
  suggestedResolutionAnchor?: string;
  suggestedCloseShape?: string;
  sourceClassesSeen: string[];
  category?: string;
  platformShapeExamples?: PlatformShapeExample[];
  duplicateAssessment: DuplicateAssessment;
  sensitivityLevel: SensitivityLevel;
  ambiguities: string[];
  riskFlags: string[];
};

type DimensionResult = {
  label: ConfidenceLabel;
  note: string;
};

const vagueQuestionHints = ["people", "care", "big deal", "discourse", "vibes", "keep caring"];
const MAX_SHAPING_SCORE = 16;

function isRecent(observedAt: string): ConfidenceLabel {
  const ageMs = Date.now() - Date.parse(observedAt);
  const ageDays = Number.isFinite(ageMs) ? ageMs / (1000 * 60 * 60 * 24) : 999;

  if (ageDays <= 21) return "high";
  if (ageDays <= 60) return "medium";
  return "low";
}

function evaluateTimeliness(input: MarketWorthinessInput): DimensionResult {
  const label = isRecent(input.observedAt);

  if (label === "high") {
    return {
      label,
      note: "Observed recently enough that a live market window still looks believable."
    };
  }

  if (label === "medium") {
    return {
      label,
      note: "Signal is no longer fresh-fresh, but it may still justify review if the event window is alive."
    };
  }

  return {
    label,
    note: "Signal looks stale for first-pass review without stronger proof that the event window is still open."
  };
}

function evaluateMarketShape(input: MarketWorthinessInput): DimensionResult {
  if (!input.question?.trim() || !input.marketForm || !input.proposedOutcomes?.length) {
    return {
      label: "low",
      note: "Question, market form, or outcomes are missing, so this is still a topic memo more than a market."
    };
  }

  if (!input.marketAngle?.trim()) {
    return {
      label: "medium",
      note: "Core market shape exists, but the tradable angle is still a little underspecified."
    };
  }

  const platformFit = evaluatePlatformShapeFit(input);

  if (platformFit) {
    return platformFit;
  }

  return {
    label: "high",
    note: "Question, angle, form, and outcome set are all present."
  };
}

function evaluateWordingClarity(question: string | undefined, ambiguities: string[]): DimensionResult {
  if (!question?.trim()) {
    return {
      label: "low",
      note: "No question text yet."
    };
  }

  const normalized = question.toLowerCase();
  const looksVague = vagueQuestionHints.some((hint) => normalized.includes(hint));

  if (looksVague || ambiguities.length >= 2 || question.length > 140) {
    return {
      label: "medium",
      note: "Question is usable, but wording still carries enough ambiguity that review will likely tighten it."
    };
  }

  return {
    label: "high",
    note: "Question reads clearly and stays bounded."
  };
}

function evaluateOutcomeShape(marketForm: MarketForm | undefined, outcomes: ProposedOutcome[] | undefined): DimensionResult {
  const count = outcomes?.length ?? 0;
  const uniqueLabels = new Set((outcomes ?? []).map((outcome) => outcome.label.trim().toLowerCase()));

  if (count === 0 || uniqueLabels.size !== count) {
    return {
      label: "low",
      note: "Outcome set is empty or duplicated."
    };
  }

  if (count > 6) {
    return {
      label: "low",
      note: "Outcome set is getting too wide for a clean first review pass."
    };
  }

  if (marketForm === "binary" && count !== 2) {
    return {
      label: "low",
      note: "Binary market should have exactly two clean sides."
    };
  }

  return {
    label: count <= 4 ? "high" : "medium",
    note: count <= 4 ? "Outcome set is compact and readable." : "Outcome set is workable, but already wants reviewer discipline."
  };
}

function evaluateResolution(input: MarketWorthinessInput): DimensionResult {
  if (!input.suggestedCloseShape?.trim()) {
    return {
      label: "low",
      note: "No explicit timeline or close shape is described yet."
    };
  }

  if (!input.resolutionFeasibility?.trim()) {
    return {
      label: "low",
      note: "No explicit resolution path is described yet."
    };
  }

  const anchor = input.suggestedResolutionAnchor?.trim();

  if (!anchor || /^unknown\b/i.test(anchor)) {
    return {
      label: "low",
      note: "Resolution anchor is missing or still unknown."
    };
  }

  if (!/https?:\/\//i.test(anchor) && !input.sourceClassesSeen.includes("authority")) {
    return {
      label: "medium",
      note: "Resolution story exists, but the authority anchor is still light."
    };
  }

  return {
    label: "high",
    note: "Resolution path is explicit and has a plausible anchor."
  };
}

function evaluateRelevance(input: MarketWorthinessInput): DimensionResult {
  if (input.signalCount >= 2 || input.sourceClassesSeen.includes("internal")) {
    return {
      label: "high",
      note: "Multiple signals or local demand hints suggest this deserves reviewer attention."
    };
  }

  if (input.category?.trim()) {
    return {
      label: "medium",
      note: "Category fit exists, but the demand signal is still thin."
    };
  }

  return {
    label: "low",
    note: "Relevance is still weakly grounded."
  };
}

function evaluateNovelty(duplicateAssessment: DuplicateAssessment): DimensionResult {
  if (duplicateAssessment === "likely-duplicate") {
    return {
      label: "low",
      note: "This looks too overlapping with an existing lineage branch."
    };
  }

  if (duplicateAssessment === "close-sibling") {
    return {
      label: "medium",
      note: "This may be valid, but sibling overlap is real and should be reviewed carefully."
    };
  }

  return {
    label: "high",
    note: duplicateAssessment === "follow-up-branch" ? "This reads like a distinct follow-up branch." : "No strong duplicate pressure is visible yet."
  };
}

function evaluateSensitivity(input: MarketWorthinessInput): DimensionResult {
  if (input.sensitivityLevel === "high") {
    return {
      label: "high",
      note: "Sensitivity is high enough that ordinary review should probably not be the final lane."
    };
  }

  if (input.sensitivityLevel === "elevated" || input.riskFlags.length > 0) {
    return {
      label: "medium",
      note: "Sensitivity or risk flags are visible and should stay explicit in handoff."
    };
  }

  return {
    label: "low",
    note: "No major sensitivity signal is visible right now."
  };
}

function evaluatePlatformShapeFit(input: MarketWorthinessInput): DimensionResult | undefined {
  const examples = input.platformShapeExamples ?? [];

  if (examples.length === 0 || !input.marketForm || !input.question?.trim()) {
    return undefined;
  }

  const sameCategory = input.category
    ? examples.filter(
        (example) => example.category?.trim().toLowerCase() === input.category?.trim().toLowerCase()
      )
    : [];
  const scopedExamples = sameCategory.length > 0 ? sameCategory : examples;
  const matchingForm = scopedExamples.filter((example) => example.marketForm === input.marketForm);
  const normalizedQuestion = input.question.trim().toLowerCase();
  const normalizedPrefix = normalizedQuestion.split(" ").slice(0, 2).join(" ");
  const prefixMatches = scopedExamples.filter((example) =>
    example.title.trim().toLowerCase().split(" ").slice(0, 2).join(" ") === normalizedPrefix
  );

  if (matchingForm.length === 0) {
    return {
      label: "medium",
      note:
        sameCategory.length > 0
          ? "Core shape exists, but it does not yet resemble the recent external reference forms seer has for this category."
          : "Core shape exists, but it does not yet resemble the recent external reference forms seer has on hand."
    };
  }

  if (prefixMatches.length > 0 || sameCategory.some((example) => example.marketForm === input.marketForm)) {
    return {
      label: "high",
      note:
        sameCategory.length > 0
          ? "Question shape lines up with recent external reference markets from Polymarket or Kalshi in this category."
          : "Question shape lines up with recent external reference markets from Polymarket or Kalshi."
    };
  }

  return {
    label: "high",
    note:
      sameCategory.length > 0
        ? "Question, angle, form, and outcome set are present, and the form matches recent external reference markets in this category."
        : "Question, angle, form, and outcome set are present, and the form matches recent external reference markets."
  };
}

function confidenceScore(label: ConfidenceLabel): number {
  if (label === "high") return 2;
  if (label === "medium") return 1;
  return 0;
}

function deriveMarketShaping(
  input: MarketWorthinessInput,
  reviewReadiness: ConfidenceLabel,
  dimensions: MarketWorthinessDimension[],
  failureReasons: WorthinessFailureReason[]
): MarketWorthinessAssessment["marketShaping"] {
  const score = dimensions.reduce((sum, dimension) => sum + confidenceScore(dimension.label), 0);
  const hardFailures = new Set<WorthinessFailureReason>([
    "likely-duplicate",
    "stale-window",
    "sensitivity-escalation"
  ]);
  const structureFailures = new Set<WorthinessFailureReason>([
    "not-market-shaped",
    "wording-too-vague",
    "outcomes-not-clean"
  ]);
  const hasHardFailure = failureReasons.some((reason) => hardFailures.has(reason));
  const hasStructureFailure = failureReasons.some((reason) => structureFailures.has(reason));
  const needsGrounding = failureReasons.includes("resolution-path-weak") || failureReasons.includes("relevance-too-low");
  const hasAuthority = input.sourceClassesSeen.includes("authority");
  const hasAmbiguity = input.ambiguities.length > 0 || input.riskFlags.length > 0;
  let tier: MarketShapingTier;

  if (hasHardFailure) {
    tier = "reject";
  } else if (hasStructureFailure) {
    tier = "watch-only";
  } else if (needsGrounding || reviewReadiness === "low") {
    tier = "needs-grounding";
  } else if (reviewReadiness === "high" && hasAuthority && !hasAmbiguity && score >= 14) {
    tier = "publish-ready";
  } else if (reviewReadiness === "high" || reviewReadiness === "medium") {
    tier = "review-ready";
  } else {
    tier = "needs-grounding";
  }

  const summary =
    tier === "publish-ready"
      ? "Shaping is strong enough to prepare for publish review after human approval."
      : tier === "review-ready"
        ? "Shaping is strong enough for human review, but may still need edits."
        : tier === "needs-grounding"
          ? "Market idea is interesting, but grounding must improve before creation."
          : tier === "watch-only"
            ? "Signal is worth tracking, but the market shape is not clean yet."
            : "Do not draft: duplicate, stale, unsafe, or too weak.";

  return {
    objectType: "market_shaping_assessment",
    tier,
    score,
    maxScore: MAX_SHAPING_SCORE,
    summary
  };
}

export function assessMarketWorthiness(input: MarketWorthinessInput): MarketWorthinessAssessment {
  const timeliness = evaluateTimeliness(input);
  const marketShape = evaluateMarketShape(input);
  const wordingClarity = evaluateWordingClarity(input.question, input.ambiguities);
  const outcomeShape = evaluateOutcomeShape(input.marketForm, input.proposedOutcomes);
  const resolutionFeasibility = evaluateResolution(input);
  const relevance = evaluateRelevance(input);
  const novelty = evaluateNovelty(input.duplicateAssessment);
  const sensitivityRisk = evaluateSensitivity(input);
  const failureReasons: WorthinessFailureReason[] = [];

  if (timeliness.label === "low") failureReasons.push("stale-window");
  if (marketShape.label === "low") failureReasons.push("not-market-shaped");
  if (wordingClarity.label === "low") failureReasons.push("wording-too-vague");
  if (outcomeShape.label === "low") failureReasons.push("outcomes-not-clean");
  if (resolutionFeasibility.label === "low") failureReasons.push("resolution-path-weak");
  if (relevance.label === "low") failureReasons.push("relevance-too-low");
  if (novelty.label === "low") failureReasons.push("likely-duplicate");
  if (sensitivityRisk.label === "high") failureReasons.push("sensitivity-escalation");

  let reviewReadiness: ConfidenceLabel = "high";

  if (failureReasons.length > 0) {
    reviewReadiness = failureReasons.some((reason) =>
      ["not-market-shaped", "outcomes-not-clean", "resolution-path-weak", "likely-duplicate"].includes(reason)
    )
      ? "low"
      : "medium";
  } else if (
    [timeliness, wordingClarity, outcomeShape, resolutionFeasibility, relevance, novelty, sensitivityRisk].some(
      (item) => item.label === "medium"
    )
  ) {
    reviewReadiness = "medium";
  }

  const summary =
    reviewReadiness === "high"
      ? "Good review candidate: shape, grounding, and duplicate pressure are all in a healthy range."
      : reviewReadiness === "medium"
        ? "Promising, but reviewer should expect edits or caution rather than a clean approve."
        : "Not ready cleanly: one or more core rubric gates are still failing.";
  const marketShaping = deriveMarketShaping(
    input,
    reviewReadiness,
    [
      timeliness,
      marketShape,
      wordingClarity,
      outcomeShape,
      resolutionFeasibility,
      relevance,
      novelty,
      sensitivityRisk
    ],
    failureReasons
  );

  return {
    objectType: "market_worthiness_assessment",
    reviewReadiness,
    marketShaping,
    timeliness,
    marketShape,
    wordingClarity,
    outcomeShape,
    resolutionFeasibility,
    relevance,
    novelty,
    sensitivityRisk,
    failureReasons,
    summary
  };
}
