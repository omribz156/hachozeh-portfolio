import type { CandidateMarket, SourceRolePlan } from "./contracts";
import type { SeerSignal } from "./signal-normalization";
import { pickPrimarySignal } from "./pipeline-signal-ranking";
import { extractFirstUrl } from "./source-reference-text";

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function deriveSourceRolePlan(signals: SeerSignal[], candidateMarket: CandidateMarket): SourceRolePlan {
  const fetchNeeds = candidateMarket.fetchNeeds ?? [];
  const category = candidateMarket.category.trim().toLowerCase();
  const wake = unique(
    signals
      .filter((signal) => signal.sourceClass === "attention" || signal.sourceClass === "context")
      .map((signal) => signal.sourceLabel)
  );
  const ground = unique(
    signals
      .filter((signal) => signal.sourceClass === "authority" || signal.sourceClass === "context")
      .map((signal) => signal.sourceLabel)
  );
  const resolve = unique([candidateMarket.suggestedResolutionAnchor].filter((value): value is string => Boolean(value)));
  const sourceUrls = unique(
    signals.map((signal) => extractFirstUrl(signal.sourceRef)).filter((value): value is string => Boolean(value))
  );
  const integrity: string[] = [];
  const notes: string[] = [];

  if (wake.length === 0) {
    wake.push(pickPrimarySignal(signals).sourceLabel);
  }

  if (category === "sports") {
    if (fetchNeeds.some((need) => need === "exact-event-date" || need === "competition-name")) {
      ground.push("trusted fixture / schedule source");
    } else if (ground.length === 0) {
      ground.push("trusted match page / fixture source");
    }

    if (resolve.length === 0) {
      resolve.push("official competition result / scoreboard");
    }
  } else if (category === "economy") {
    if (ground.length === 0) {
      ground.push("relevant official announcement source");
    }

    if (resolve.length === 0) {
      resolve.push("official central-bank / macro release");
    }
  } else if (category === "security") {
    if (ground.length === 0) {
      ground.push("official agency follow-up notice");
    }

    if (resolve.length === 0) {
      resolve.push("official agency follow-up notice");
    }

    integrity.push("official contradiction / integrity check");
  } else if (category === "travel") {
    if (ground.length === 0) {
      ground.push("operator / authority status notice");
    }

    if (resolve.length === 0) {
      resolve.push("operator / authority follow-up notice");
    }
  } else if (category === "science") {
    if (ground.length === 0) {
      ground.push("official hazard bulletin");
    }

    if (resolve.length === 0) {
      resolve.push("official hazard authority update");
    }

    integrity.push("cross-authority hazard sanity check");
  } else if (category === "politics") {
    if (ground.length === 0) {
      ground.push("official election / government source");
    }

    if (resolve.length === 0) {
      resolve.push("official election / government result");
    }
  } else {
    if (ground.length === 0) {
      ground.push("official or context cross-reference");
    }

    if (resolve.length === 0) {
      resolve.push("official follow-up anchor");
    }
  }

  if (fetchNeeds.length > 0) {
    notes.push(`fallback cross-reference still needed for: ${fetchNeeds.join(", ")}`);
  }

  if (sourceUrls.length > 0 && !resolve.some((entry) => extractFirstUrl(entry))) {
    if (resolve.length > 0) {
      resolve[0] = `${resolve[0]}: ${sourceUrls[0]}`;
    } else {
      resolve.push(sourceUrls[0]);
    }
  }

  return {
    wake,
    ground: unique(ground),
    resolve: unique(resolve),
    integrity: integrity.length > 0 ? unique(integrity) : undefined,
    notes: notes.length > 0 ? notes : undefined
  };
}
