import type { Pool } from "pg";

import type { RequestActor } from "../../back/src/platform-surface/oracle";
import {
  inspectOracleMarket,
  OracleInspectionError
} from "./inspect-market-service";
import { approveOracleResolutionCase } from "./review-action-service";

export type OracleOperatorResolveMode = "test" | "official" | "manual";

type OperatorResolveMarketRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  title: string;
  category_key: string | null;
  resolution_source: string;
  created_by: string | null;
};

export type OperatorResolveRequest = {
  marketId: string;
  mode: OracleOperatorResolveMode;
  winningOutcomeId?: string | null;
  winningOutcomeKey?: string | null;
  reasonSummary: string;
  evidenceUrl: string;
  evidenceLabel: string;
  claimSummary?: string | null;
  evidenceSummary?: string | null;
  resolvedAtObserved?: string | null;
  approve?: boolean;
  reviewNote?: string | null;
  idempotencyKey?: string | null;
  persistResult?: boolean;
};

export type OperatorResolveResult = {
  objectType: "oracle_operator_resolve_result";
  mode: OracleOperatorResolveMode;
  market: {
    marketId: string;
    title: string;
    status: OperatorResolveMarketRow["status"];
    categoryKey: string | null;
    resolutionSource: string;
    createdBy: string | null;
  };
  intake: Awaited<ReturnType<typeof inspectOracleMarket>>;
  approval: Awaited<ReturnType<typeof approveOracleResolutionCase>> | null;
  nextAction: "review_case" | "resolved";
  approvalCommand: string | null;
};

export class OracleOperatorResolveError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "OracleOperatorResolveError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function readTrimmed(value: string | null | undefined, fieldName: string): string {
  const trimmed = value?.trim();

  if (!trimmed) {
    throw new OracleOperatorResolveError(400, "invalid_request", `${fieldName} is required.`);
  }

  return trimmed;
}

async function readMarket(dbPool: Pool, marketId: string): Promise<OperatorResolveMarketRow> {
  const result = await dbPool.query<OperatorResolveMarketRow>(
    `
      select
        id,
        status,
        title,
        category_key,
        resolution_source,
        created_by
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );
  const row = result.rows[0];

  if (!row) {
    throw new OracleOperatorResolveError(404, "market_not_found", `Market not found: ${marketId}`);
  }

  return row;
}

function isTestLikeMarket(market: OperatorResolveMarketRow): boolean {
  const haystack = [
    market.id,
    market.category_key,
    market.resolution_source,
    market.created_by
  ]
    .filter((value): value is string => Boolean(value))
    .join(" ")
    .toLowerCase();

  return /\b(stress|synthetic|test|gauntlet|oracle-eol)\b/.test(haystack);
}

function assertOperatorResolveAllowed(
  market: OperatorResolveMarketRow,
  request: OperatorResolveRequest
): void {
  if (market.status !== "closed") {
    throw new OracleOperatorResolveError(
      409,
      "market_not_closed",
      "Operator resolve only works on closed markets. Close through Horizon first."
    );
  }

  if (!request.winningOutcomeId && !request.winningOutcomeKey) {
    throw new OracleOperatorResolveError(
      400,
      "invalid_request",
      "winningOutcomeId or winningOutcomeKey is required."
    );
  }

  if (request.mode === "test" && !isTestLikeMarket(market)) {
    throw new OracleOperatorResolveError(
      409,
      "market_not_test_like",
      "test mode is only allowed for synthetic/test/stress/gauntlet markets."
    );
  }
}

function sourceTypeForMode(mode: OracleOperatorResolveMode): string {
  if (mode === "official") {
    return "official";
  }

  if (mode === "test") {
    return "test_operator";
  }

  return "manual_operator";
}

function normalizeInspectionError(error: OracleInspectionError): OracleOperatorResolveError {
  const message = error.message;

  if (message.startsWith("Winning outcome")) {
    return new OracleOperatorResolveError(409, "winning_outcome_invalid", message);
  }

  if (message.startsWith("Invalid ISO timestamp:") || message.endsWith(" is required.")) {
    return new OracleOperatorResolveError(400, "invalid_request", message);
  }

  return new OracleOperatorResolveError(409, "operator_resolve_not_intakeable", message);
}

export async function operatorResolveMarket(
  dbPool: Pool,
  actor: RequestActor,
  request: OperatorResolveRequest
): Promise<OperatorResolveResult> {
  const market = await readMarket(dbPool, request.marketId);

  assertOperatorResolveAllowed(market, request);

  const reasonSummary = readTrimmed(request.reasonSummary, "reasonSummary");
  const evidenceUrl = readTrimmed(request.evidenceUrl, "evidenceUrl");
  const evidenceLabel = readTrimmed(request.evidenceLabel, "evidenceLabel");

  try {
    const intake = await inspectOracleMarket(
      dbPool,
      {
        marketId: market.id,
        caseType: "resolution_check",
        sources: [
          {
            sourceUrl: evidenceUrl,
            sourceLabel: evidenceLabel,
            sourceType: sourceTypeForMode(request.mode),
            claimSummary: request.claimSummary?.trim() || reasonSummary
          }
        ],
        winningOutcomeId: request.winningOutcomeId ?? null,
        winningOutcomeKey: request.winningOutcomeKey ?? null,
        evidenceSummary:
          request.evidenceSummary?.trim() ||
          `Operator ${request.mode} resolution evidence: ${evidenceLabel}`,
        reasonSummary,
        summary: `Operator ${request.mode} resolution case for "${market.title}".`,
        requiresHumanReview: !request.approve,
        reviewType: null,
        reviewSeverity: null,
        reviewSummary: null,
        reviewNotes: [
          `Operator resolve mode: ${request.mode}`,
          `Operator actor: ${actor.actorId}`
        ].join("\n"),
        recommendedNextAction: request.approve ? "approve" : "inspect",
        resolvedAtObserved: request.resolvedAtObserved ?? null
      },
      {
        persistResult: request.persistResult ?? true
      }
    );

    if (intake.output.objectType !== "resolution_recommendation") {
      throw new OracleOperatorResolveError(
        409,
        "operator_resolve_not_recommended",
        "Operator resolve intake did not produce a resolution recommendation."
      );
    }

    if (!request.approve) {
      return {
        objectType: "oracle_operator_resolve_result",
        mode: request.mode,
        market: {
          marketId: market.id,
          title: market.title,
          status: market.status,
          categoryKey: market.category_key,
          resolutionSource: market.resolution_source,
          createdBy: market.created_by
        },
        intake,
        approval: null,
        nextAction: "review_case",
        approvalCommand: `npm --prefix systems/back run oracle -- approve-resolution-case --case ${intake.oracleCase.oracleCaseId} --json`
      };
    }

    const approval = await approveOracleResolutionCase(
      dbPool,
      intake.oracleCase.oracleCaseId,
      actor,
      {
        reviewNote: request.reviewNote?.trim() || reasonSummary,
        idempotencyKey:
          request.idempotencyKey?.trim() ||
          `operator-resolve:${market.id}:${request.mode}:${intake.oracleCase.oracleCaseId}`
      }
    );

    return {
      objectType: "oracle_operator_resolve_result",
      mode: request.mode,
      market: {
        marketId: market.id,
        title: market.title,
        status: market.status,
        categoryKey: market.category_key,
        resolutionSource: market.resolution_source,
        createdBy: market.created_by
      },
      intake,
      approval,
      nextAction: "resolved",
      approvalCommand: null
    };
  } catch (error) {
    if (error instanceof OracleInspectionError) {
      throw normalizeInspectionError(error);
    }

    throw error;
  }
}
