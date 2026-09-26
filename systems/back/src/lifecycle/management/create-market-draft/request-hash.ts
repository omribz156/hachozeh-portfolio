import { hashStablePayload } from "../../../shared/stable-hash";
import type { CreateMarketDraftRequest, ResolvedDraftOutcomeInput } from "./types";

export function buildRequestHash(
  marketId: string,
  outcomes: ResolvedDraftOutcomeInput[],
  request: CreateMarketDraftRequest
): string {
  return hashStablePayload({
    ...request,
    marketId,
    outcomes: outcomes.map((outcome) => ({
      outcomeId: outcome.outcomeId,
      label: outcome.label,
      shortLabel: outcome.shortLabel,
      description: outcome.description,
      colorKey: outcome.colorKey
    }))
  });
}
