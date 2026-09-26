import type {
  IntakeLane,
  ManualSeerSignal,
  MarketForm,
  ProposedOutcome,
  SignalMarketability,
  SignalTopicKind,
  SensitivityLevel,
  SourceClass
} from "./contracts";
import { buildSignalFollowUpNotes } from "./follow-up-grounding";
import { normalizeIntakeLane } from "./intake-lanes";
import { type SeerSeedSignal } from "./seed-signals";
import { enrichSignal } from "./signal-enrichment";
import { findSeerSource } from "./source-registry";
import { slugify } from "./text";

export type SeerSignal = {
  signalId: string;
  signalOrigin: "seed" | "manual";
  sourceId: string;
  intakeLane: IntakeLane;
  recurringTemplateId?: ManualSeerSignal["recurringTemplateId"];
  clusterKey: string;
  lineageLabel: string;
  title: string;
  summary: string;
  category: string;
  sourceCategory: string;
  inferredCategory: string;
  whyNow: string;
  observedAt: string;
  sourceClass: SourceClass;
  sourceRef: string;
  sourceLabel: string;
  keyEntities: string[];
  sourceSummary: string;
  topicKind: SignalTopicKind;
  marketability: SignalMarketability;
  inferenceNotes: string[];
  question?: string;
  marketAngle?: string;
  marketForm?: MarketForm;
  proposedOutcomes?: ProposedOutcome[];
  marketWorthiness?: string;
  resolutionFeasibility?: string;
  suggestedCloseShape?: string;
  suggestedResolutionAnchor?: string;
  sensitivityLevel?: SensitivityLevel;
  ambiguityNotes?: string[];
  riskFlags?: string[];
  draftedByEnrichment?: boolean;
};

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function deriveIntakeLaneFromHints(
  intakeLane: IntakeLane | undefined,
  notes?: string[],
  tags?: string[]
): IntakeLane {
  if (intakeLane) {
    return normalizeIntakeLane(intakeLane);
  }

  const values = [...(notes ?? []), ...(tags ?? [])];

  if (
    values.some(
      (value) =>
        value === "planned" ||
        value === "planned-event" ||
        value === "intake-lane=planned" ||
        value === "intake-lane=planned-event"
    )
  ) {
    return "planned";
  }

  return "live";
}

function normalizeClusterKey(signal: ManualSeerSignal): string {
  if (signal.clusterHint?.trim()) {
    return slugify(signal.clusterHint);
  }

  const matchupKey = normalizeMatchupKey(signal.title);

  if (matchupKey) {
    return matchupKey;
  }

  return slugify(signal.clusterHint ?? signal.lineageHint ?? `${signal.category}-${signal.title}`);
}

function normalizeLineageLabel(signal: ManualSeerSignal): string {
  if (signal.lineageHint?.trim()) {
    return slugify(signal.lineageHint);
  }

  const matchupKey = normalizeMatchupKey(signal.title);

  if (matchupKey) {
    return matchupKey;
  }

  return slugify(signal.lineageHint ?? signal.clusterHint ?? `${signal.category}-${signal.title}`);
}

function normalizeMatchupKey(title: string): string | undefined {
  const match = title.match(/^(.+?)\s+vs\.?\s+(.+)$/i);
  const left = match?.[1]?.trim().toLowerCase();
  const right = match?.[2]?.trim().toLowerCase();

  if (!left || !right) {
    return undefined;
  }

  return `sports_match_${slugify([left, right].sort().join("_vs_"))}`;
}

function manualSourceSummary(signal: ManualSeerSignal, sourceLabel: string): string {
  return `קלט ${sourceLabel}: ${signal.whyNow}`;
}

async function normalizeManualImportedSignal(
  signal: ManualSeerSignal,
  sourceClass: SourceClass,
  sourceLabel: string,
  sourceRef: string
): Promise<SeerSignal> {
  const enrichmentInput = {
    sourceId: signal.sourceId,
    sourceClass,
    category: signal.category,
    title: signal.title,
    summary: signal.summary,
    whyNow: signal.whyNow,
    observedAt: signal.observedAt,
    keyEntities: signal.keyEntities,
    notes: signal.notes,
    tags: signal.tags,
    question: signal.question,
    marketForm: signal.marketForm,
    proposedOutcomes: signal.proposedOutcomes
  };
  const firstPassEnrichment = enrichSignal(enrichmentInput);
  const followUpNotes = await buildSignalFollowUpNotes(signal, firstPassEnrichment);
  const enrichedNotes =
    followUpNotes.length > 0 ? unique([...(signal.notes ?? []), ...followUpNotes]) : signal.notes;
  const enrichment = followUpNotes.length > 0 ? enrichSignal({ ...enrichmentInput, notes: enrichedNotes }) : firstPassEnrichment;
  const normalizedSignal = {
    ...signal,
    notes: enrichedNotes,
    clusterHint: enrichment.draftClusterHint ?? signal.clusterHint,
    lineageHint: enrichment.draftLineageHint ?? signal.lineageHint
  };

  return {
    signalId: signal.signalId,
    signalOrigin: "manual",
    sourceId: signal.sourceId,
    intakeLane: deriveIntakeLaneFromHints(signal.intakeLane, enrichedNotes, signal.tags),
    recurringTemplateId: signal.recurringTemplateId ?? enrichment.draftRecurringTemplateId,
    clusterKey: normalizeClusterKey(normalizedSignal),
    lineageLabel: normalizeLineageLabel(normalizedSignal),
    title: signal.title,
    summary: signal.summary,
    category: enrichment.inferredCategory,
    sourceCategory: enrichment.sourceCategory,
    inferredCategory: enrichment.inferredCategory,
    whyNow: signal.whyNow,
    observedAt: signal.observedAt,
    sourceClass,
    sourceRef,
    sourceLabel,
    keyEntities: signal.keyEntities ?? [],
    sourceSummary: manualSourceSummary(signal, sourceLabel),
    topicKind: enrichment.topicKind,
    marketability: enrichment.marketability,
    inferenceNotes: enrichment.inferenceNotes,
    question: signal.question ?? enrichment.draftQuestion,
    marketAngle: signal.marketAngle ?? enrichment.draftMarketAngle,
    marketForm: signal.marketForm ?? enrichment.draftMarketForm,
    proposedOutcomes: signal.proposedOutcomes ?? enrichment.draftOutcomes,
    marketWorthiness: signal.marketWorthiness ?? enrichment.draftMarketWorthiness,
    resolutionFeasibility: signal.resolutionFeasibility ?? enrichment.draftResolutionFeasibility,
    suggestedCloseShape: signal.suggestedCloseShape ?? enrichment.draftSuggestedCloseShape,
    suggestedResolutionAnchor: signal.suggestedResolutionAnchor ?? enrichment.draftSuggestedResolutionAnchor,
    sensitivityLevel: signal.sensitivityLevel ?? enrichment.draftSensitivityLevel,
    ambiguityNotes: signal.ambiguityNotes ?? enrichment.draftAmbiguityNotes,
    riskFlags: signal.riskFlags ?? enrichment.draftRiskFlags,
    draftedByEnrichment: !signal.question && Boolean(enrichment.draftQuestion)
  };
}

export async function normalizeManualSignal(signal: ManualSeerSignal): Promise<SeerSignal> {
  const source = await findSeerSource(signal.sourceId);
  const sourceClass = source?.primaryClass ?? "attention";
  const sourceLabel = signal.sourceLabel ?? source?.label ?? signal.sourceId;
  const sourceRef = signal.sourceRef ?? source?.homepage ?? signal.sourceId;

  return normalizeManualImportedSignal(signal, sourceClass, sourceLabel, sourceRef);
}

export function normalizeSeedSignal(signal: SeerSeedSignal): SeerSignal {
  const enrichment = enrichSignal({
    sourceId: signal.sourceId,
    sourceClass: signal.sourceClass,
    category: signal.category,
    title: signal.title,
    summary: signal.summary,
    whyNow: signal.whyNow,
    observedAt: signal.observedAt,
    keyEntities: signal.keyEntities,
    question: signal.question,
    marketForm: signal.marketForm,
    proposedOutcomes: signal.proposedOutcomes
  });

  return {
    ...signal,
    signalOrigin: "seed",
    intakeLane: signal.intakeLane,
    category: enrichment.inferredCategory,
    sourceCategory: enrichment.sourceCategory,
    inferredCategory: enrichment.inferredCategory,
    topicKind: enrichment.topicKind,
    marketability: enrichment.marketability,
    inferenceNotes: enrichment.inferenceNotes
  };
}
