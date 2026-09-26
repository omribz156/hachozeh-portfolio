export type PlannedEventWarmupPolicy = {
  maxUpcomingSiblings: number;
  horizonDays: number;
  maxRoundOffset?: number;
};

export const plannedEventWarmupPolicies = {
  "boi-rate-decision-v1": {
    maxUpcomingSiblings: 3,
    horizonDays: 180
  },
  "sports-match-winner-v1": {
    maxUpcomingSiblings: 6,
    horizonDays: 21,
    maxRoundOffset: 1
  }
} as const satisfies Record<string, PlannedEventWarmupPolicy>;

export function getPlannedEventWarmupPolicy(
  recurringTemplateId: keyof typeof plannedEventWarmupPolicies
): PlannedEventWarmupPolicy {
  return plannedEventWarmupPolicies[recurringTemplateId];
}

export function isWithinUpcomingHorizon(
  observedAt: string,
  generatedAt: string,
  horizonDays: number
): boolean {
  const observedTime = Date.parse(observedAt);
  const generatedTime = Date.parse(generatedAt);

  if (Number.isNaN(observedTime) || Number.isNaN(generatedTime)) {
    return true;
  }

  if (observedTime < generatedTime) {
    return false;
  }

  return observedTime - generatedTime <= horizonDays * 24 * 60 * 60 * 1000;
}
