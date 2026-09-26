import type { SeerSignal } from "./signal-normalization";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function extractFetchNeeds(notes?: string[]): string[] {
  return unique(
    (notes ?? [])
      .map((note) => note.match(/^fetch-needed=(.+)$/i)?.[1]?.trim())
      .filter((value): value is string => Boolean(value))
  );
}

function groundingSignalScore(signal: SeerSignal): number {
  const notes = signal.ambiguityNotes ?? [];
  const hasExplicitDate = notes.some((note) => note.startsWith("grounding: event-date=") && !note.includes("observed-trend-window"));
  const hasProvisionalDate = notes.some((note) => note.includes("observed-trend-window"));
  const hasCompetition = notes.some((note) => note.includes("grounding: competition="));
  const fetchNeedCount = extractFetchNeeds(notes).length;

  return (hasExplicitDate ? 25 : 0) + (hasCompetition ? 15 : 0) - (hasProvisionalDate ? 10 : 0) - fetchNeedCount * 5;
}

export function hasProposalShape(signal: SeerSignal): boolean {
  return Boolean(signal.question?.trim() && signal.marketForm && signal.proposedOutcomes && signal.proposedOutcomes.length > 0);
}

function scoreSignal(signal: SeerSignal): number {
  const observedWeight = Math.floor((Date.parse(signal.observedAt) || 0) / (24 * 60 * 60 * 1000));
  const proposalWeight = hasProposalShape(signal) ? 100 : 0;
  const authorityWeight = signal.sourceClass === "authority" ? 50 : signal.sourceClass === "context" ? 20 : 0;
  const manualWeight = signal.signalOrigin === "manual" ? 5 : 0;
  const templateWeight = signal.recurringTemplateId ? 10 : 0;

  return proposalWeight + authorityWeight + manualWeight + templateWeight + groundingSignalScore(signal) + observedWeight;
}

export function pickPrimarySignal(signals: SeerSignal[]): SeerSignal {
  return [...signals].sort((left, right) => scoreSignal(right) - scoreSignal(left))[0]!;
}

export function pickProposalSignal(signals: SeerSignal[]): SeerSignal | undefined {
  return [...signals]
    .filter(hasProposalShape)
    .sort((left, right) => scoreSignal(right) - scoreSignal(left))[0];
}
