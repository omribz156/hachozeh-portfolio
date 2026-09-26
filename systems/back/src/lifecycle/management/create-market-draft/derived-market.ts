import { createHash } from "node:crypto";

import { slugifyMarketIdPart } from "../market-slug";
import { CreateMarketDraftServiceError } from "./errors";
import type {
  CreateMarketDraftRequest,
  DraftOutcomeInput,
  ResolvedDraftOutcomeInput
} from "./types";

export function buildDerivedMarketId(actorId: string, request: CreateMarketDraftRequest): string {
  if (request.marketId) {
    return request.marketId;
  }

  const titleSlug = slugifyMarketIdPart(request.title, "market");
  const suffix = createHash("sha256")
    .update(`${actorId}:${request.idempotencyKey}`)
    .digest("hex")
    .slice(0, 8);

  return `${titleSlug}-${suffix}`;
}

function formatSlugTimestamp(value: string): string | null {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const year = String(date.getUTCFullYear());
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const datePart = `${year}${month}${day}`;

  return hour === "00" && minute === "00" ? datePart : `${datePart}-${hour}${minute}`;
}

export function buildDerivedEventSlug(request: CreateMarketDraftRequest, marketId: string): string {
  const explicitSlug = slugifyMarketIdPart(request.eventSlug ?? "", "");

  if (explicitSlug) {
    return explicitSlug;
  }

  const titleSlug = slugifyMarketIdPart(request.eventTitle ?? request.title, "");
  const identitySlug = slugifyMarketIdPart(request.eventId ?? marketId, "event");
  const timeSuffix = formatSlugTimestamp(request.closeAt);

  return [titleSlug || identitySlug, timeSuffix].filter(Boolean).join("-");
}

export function buildResolvedOutcomes(
  marketId: string,
  outcomes: DraftOutcomeInput[]
): ResolvedDraftOutcomeInput[] {
  const usedIds = new Set<string>();

  return outcomes.map((outcome, index) => {
    let outcomeId = outcome.outcomeId;

    if (!outcomeId) {
      outcomeId = `${marketId}-outcome-${slugifyMarketIdPart(outcome.label, `option-${index + 1}`)}`;
    }

    if (usedIds.has(outcomeId)) {
      if (outcome.outcomeId) {
        throw new CreateMarketDraftServiceError(
          400,
          "invalid_request",
          `outcomes[${index}].outcomeId must be unique.`
        );
      }

      outcomeId = `${outcomeId}-${index + 1}`;
    }

    usedIds.add(outcomeId);

    return {
      ...outcome,
      outcomeId
    };
  });
}
