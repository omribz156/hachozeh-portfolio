import type { DraftOutcomeInput, MarketContractV1Snapshot } from "./types";

function readOutcomeLabel(outcome: DraftOutcomeInput): string {
  return (outcome.shortLabel || outcome.label).trim();
}

function isGenericBinaryLabel(value: string): boolean {
  return ["כן", "לא", "yes", "no"].includes(value.trim().toLowerCase());
}

function hasNamedOpponentShape(contract: MarketContractV1Snapshot): boolean {
  if (contract.resultShape === "home_away_winner") {
    return true;
  }

  const outcomeMap = Array.isArray(contract.outcomeMap) ? contract.outcomeMap : [];

  return (
    outcomeMap.length === 2 &&
    outcomeMap.every(
      (outcome) =>
        outcome &&
        typeof outcome === "object" &&
        !Array.isArray(outcome) &&
        (outcome as { outcomeKind?: unknown }).outcomeKind === "named-outcome"
    )
  );
}

export function addDerivedContractDisplayHints(
  contract: MarketContractV1Snapshot | null,
  outcomes: DraftOutcomeInput[]
): MarketContractV1Snapshot | null {
  if (!contract || contract.displayHints || outcomes.length !== 2) {
    return contract;
  }

  if (!hasNamedOpponentShape(contract)) {
    return contract;
  }

  const [affirmativeLabel, negativeLabel] = outcomes.map(readOutcomeLabel);

  if (
    !affirmativeLabel ||
    !negativeLabel ||
    isGenericBinaryLabel(affirmativeLabel) ||
    isGenericBinaryLabel(negativeLabel)
  ) {
    return contract;
  }

  return {
    ...contract,
    displayHints: {
      binaryPresentation: "named_opponents",
      affirmativeLabel,
      negativeLabel,
      notes: ["Render the binary ticket as named opponents, not yes/no copy."]
    }
  };
}
