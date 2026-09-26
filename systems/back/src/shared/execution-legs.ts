export type ExecutionLeg = {
  outcome_id: string;
  share_amount: string;
};

export function readExecutionLegs(value: unknown): ExecutionLeg[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }

      const candidate = entry as Record<string, unknown>;

      if (
        typeof candidate.outcome_id !== "string" ||
        typeof candidate.share_amount !== "string"
      ) {
        return null;
      }

      return {
        outcome_id: candidate.outcome_id,
        share_amount: candidate.share_amount
      };
    })
    .filter((entry): entry is ExecutionLeg => entry !== null);
}
