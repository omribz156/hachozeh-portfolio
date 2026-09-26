import type {
  DraftOracleSourcePolicy,
  MarketFamilyClassification,
  ProposedOutcome,
  ReviewFeedbackItem,
  ReviewHandoffItem,
  SourceRegistryEntry
} from "./contracts";
import { buildContractDuplicateKey, resolveFamilyKey } from "./creation-contract-identity";
import { resolveCreationCategoryKey } from "./creation-draft-shape";
import { classifyMarketFamily } from "./market-family-classifier";
import {
  resolveContractLifecycleFromRegistry,
  type ResolvedContractLifecycle
} from "./source-lifecycle";

const REFERENCE_ONLY_RESOLUTION_HOSTS = ["polymarket.com", "kalshi.com"];

export type MarketCreationBlocker =
  | "no-review-item"
  | "review-feedback-missing"
  | "non-positive-review-action"
  | "duplicate-contract"
  | "hebrew-localization-needed"
  | "out-of-scope-category"
  | "fetch-needs-open"
  | "missing-source-url"
  | "missing-ground-plan"
  | "missing-resolve-plan"
  | "missing-close-shape"
  | "stale-close-window"
  | "missing-resolution-anchor"
  | "reference-only-resolution-source"
  | "missing-oracle-capability"
  | "oracle-capability-blocked"
  | "market-family-not-classified"
  | "source-family-needed"
  | "market-family-adapter-needed"
  | "market-family-policy-review";

export type MarketCreationGateResult =
  | { okay: true; categoryKey: string; closeAt: string; familyClassification: MarketFamilyClassification }
  | { okay: false; blockers: MarketCreationBlocker[]; familyClassification: MarketFamilyClassification };

function isPositiveAction(action: ReviewFeedbackItem["action"]): boolean {
  return action === "approve" || action === "approve-with-edits";
}

export function parseCloseAtFromShape(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const match = value.match(/([A-Za-z]+ \d{1,2}, 20\d{2})(?: at (\d{1,2}:\d{2}))?/);

  if (!match?.[1]) {
    return null;
  }

  const parsed = new Date(match[2] ? `${match[1]} ${match[2]} UTC` : `${match[1]} UTC`);

  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString();
}

export function resolveContractLifecycle(
  item: ReviewHandoffItem,
  sourceRegistry: SourceRegistryEntry[]
): ResolvedContractLifecycle {
  return resolveContractLifecycleFromRegistry(
    {
      recurringTemplateId: item.recurringTemplateId,
      marketForm: item.marketForm,
      sourceIds: item.topSourceIds
    },
    sourceRegistry
  );
}

export function buildFamilyClassification(
  item: ReviewHandoffItem,
  sourceRegistry: SourceRegistryEntry[],
  feedback?: ReviewFeedbackItem
): MarketFamilyClassification {
  const lifecycle = resolveContractLifecycle(item, sourceRegistry);

  return classifyMarketFamily(
    {
      category: feedback?.editedCategory?.trim() || item.category,
      question: feedback?.editedQuestion?.trim() || item.question,
      marketForm: item.marketForm,
      recurringTemplateId: item.recurringTemplateId,
      sourceIds: item.topSourceIds ?? item.contract?.resolutionSource.sourceIds,
      measurementKind: item.contract?.measurementKind ?? lifecycle.measurementKind,
      resultShape: item.contract?.resultShape ?? lifecycle.resultShape,
      sensitivityLevel: item.sensitivityLevel,
      feedback
    },
    sourceRegistry
  );
}

export function resolveContractTopRisks(
  item: ReviewHandoffItem,
  lifecycle: ResolvedContractLifecycle
): string[] | undefined {
  const risks = item.topRisks ?? [];

  if (lifecycle.oracleCapability === "manual_resolution_required") {
    return risks.length ? risks : undefined;
  }

  const currentRisks = risks.filter((risk) => !/^manual-resolution-required-until-[a-z0-9-]+-adapter-exists$/i.test(risk));
  return currentRisks.length ? currentRisks : undefined;
}

function extractFirstUrl(value: string | undefined): string | null {
  return value?.match(/https?:\/\/\S+/)?.[0]?.replace(/[),.;]+$/, "") ?? null;
}

function isReferenceOnlyResolutionAnchor(value: string | undefined): boolean {
  const url = extractFirstUrl(value);

  if (!url) {
    return false;
  }

  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");

    return REFERENCE_ONLY_RESOLUTION_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`));
  } catch {
    return REFERENCE_ONLY_RESOLUTION_HOSTS.some((host) => url.toLowerCase().includes(host));
  }
}

function hasHebrewText(value: string | undefined): boolean {
  return /[\u0590-\u05ff]/u.test(value ?? "");
}

function hasHebrewFirstMarketText(question: string, outcomes: ProposedOutcome[]): boolean {
  return hasHebrewText(question) && outcomes.every((outcome) => hasHebrewText(outcome.label));
}

export function buildOracleSourcePolicy(
  item: ReviewHandoffItem,
  sourceRegistry: SourceRegistryEntry[]
): DraftOracleSourcePolicy | null {
  const topSourceIds = item.topSourceIds ?? [];

  if (topSourceIds.length === 0) {
    return null;
  }

  const lifecycle = resolveContractLifecycle(item, sourceRegistry);
  const notes = [
    ...(item.sourceRolePlan?.wake.map((entry) => `wake-role=${entry}`) ?? []),
    ...(item.sourceRolePlan?.ground.map((entry) => `ground-role=${entry}`) ?? []),
    ...(item.sourceRolePlan?.resolve.map((entry) => `resolve-role=${entry}`) ?? []),
    ...(item.sourceRolePlan?.integrity?.map((entry) => `integrity-role=${entry}`) ?? []),
    ...(lifecycle.measurementKind ? [`measurement-kind=${lifecycle.measurementKind}`] : []),
    ...(lifecycle.resultShape ? [`result-shape=${lifecycle.resultShape}`] : []),
    ...(lifecycle.oracleCapability ? [`oracle-capability=${lifecycle.oracleCapability}`] : []),
    ...((item.fetchNeeds ?? []).map((entry) => `fetch-needed=${entry}`)),
    ...(item.sourceRolePlan?.notes ?? [])
  ];

  return {
    preferredSourceIds: topSourceIds,
    contextSourceIds: topSourceIds,
    resolutionSourceIds: topSourceIds,
    requiresHumanReviewOnSourceConflict: true,
    requiresHumanReviewOnWeakAuthority: item.authorityReadiness !== "high" ? true : undefined,
    notes: notes.length > 0 ? notes : undefined
  };
}

export function resolveFeedbackCategory(item: ReviewHandoffItem, feedback: ReviewFeedbackItem): string | undefined {
  return feedback.editedCategory?.trim() || item.category;
}

function blockerForFamilyClassification(
  classification: MarketFamilyClassification
): MarketCreationBlocker | null {
  switch (classification.status) {
    case "classified":
      return null;
    case "source_family_needed":
      return "source-family-needed";
    case "adapter_needed":
      return "market-family-adapter-needed";
    case "policy_review":
      return "market-family-policy-review";
    case "blocked":
      return "oracle-capability-blocked";
    case "family_proposal":
    default:
      return "market-family-not-classified";
  }
}

export function evaluateCreationGate(
  item: ReviewHandoffItem,
  feedback: ReviewFeedbackItem,
  sourceRegistry: SourceRegistryEntry[]
): MarketCreationGateResult {
  const blockers: MarketCreationBlocker[] = [];

  if (!isPositiveAction(feedback.action)) {
    blockers.push("non-positive-review-action");
  }

  const question = feedback.editedQuestion?.trim() || item.question;
  const proposedOutcomes = feedback.editedOutcomes?.length ? feedback.editedOutcomes : item.proposedOutcomes;

  if (!hasHebrewFirstMarketText(question, proposedOutcomes)) {
    blockers.push("hebrew-localization-needed");
  }

  const categoryKey = resolveCreationCategoryKey(resolveFeedbackCategory(item, feedback));

  if (!categoryKey) {
    blockers.push("out-of-scope-category");
  }

  if ((item.fetchNeeds?.length ?? 0) > 0) {
    blockers.push("fetch-needs-open");
  }

  if (!item.sourceRolePlan?.ground?.length) {
    blockers.push("missing-ground-plan");
  }

  if (!item.sourceRolePlan?.resolve?.length) {
    blockers.push("missing-resolve-plan");
  }

  const closeAt = parseCloseAtFromShape(feedback.editedCloseShape?.trim() || item.suggestedCloseShape);

  if (!closeAt) {
    blockers.push("missing-close-shape");
  }

  if (closeAt && Date.parse(closeAt) <= Date.parse(feedback.reviewedAt)) {
    blockers.push("stale-close-window");
  }

  const resolutionAnchor =
    (feedback.editedResolutionAnchor?.trim() || item.suggestedResolutionAnchor) ??
    item.sourceRolePlan?.resolve?.[0];

  if (!resolutionAnchor) {
    blockers.push("missing-resolution-anchor");
  }

  if (!extractFirstUrl(resolutionAnchor)) {
    blockers.push("missing-source-url");
  }

  if (isReferenceOnlyResolutionAnchor(resolutionAnchor)) {
    blockers.push("reference-only-resolution-source");
  }

  const lifecycle = resolveContractLifecycle(item, sourceRegistry);
  const familyClassification = buildFamilyClassification(item, sourceRegistry, feedback);
  const familyBlocker = blockerForFamilyClassification(familyClassification);
  const legacyFamilyKey = resolveFamilyKey(item);

  if (!lifecycle.oracleCapability) {
    blockers.push("missing-oracle-capability");
  } else if (lifecycle.oracleCapability === "blocked") {
    blockers.push("oracle-capability-blocked");
  }

  const familyBlockerIsBackCompatOnly =
    Boolean(legacyFamilyKey) &&
    (familyBlocker === "market-family-not-classified" ||
      familyBlocker === "source-family-needed" ||
      (familyBlocker === "market-family-adapter-needed" && Boolean(lifecycle.oracleCapability)));

  if (familyBlocker && !familyBlockerIsBackCompatOnly && !blockers.includes(familyBlocker)) {
    blockers.push(familyBlocker);
  }

  if (blockers.length > 0 || !categoryKey || !closeAt) {
    return {
      okay: false,
      blockers,
      familyClassification
    };
  }

  return {
    okay: true,
    categoryKey,
    closeAt,
    familyClassification
  };
}

export function isDuplicateCreationDraft(
  item: ReviewHandoffItem,
  feedback: ReviewFeedbackItem,
  seenDraftDuplicateKeys: Set<string>
): boolean {
  const duplicateKey = buildContractDuplicateKey(item, feedback);

  if (duplicateKey && seenDraftDuplicateKeys.has(duplicateKey)) {
    return true;
  }

  if (duplicateKey) {
    seenDraftDuplicateKeys.add(duplicateKey);
  }

  return false;
}
