import type { Pool } from "pg";

import { type Queryable, withTransaction } from "../../back/src/platform-surface/oracle";
import type {
  EvidencePacket,
  OracleAmbiguityLevel,
  OracleCase,
  OracleCaseType,
  OracleEvidenceSource,
  OracleInspectionResult,
  OracleRecommendationOutput
} from "./contracts";
import type { OracleMarketContext } from "./inspect-market-read-model";

type ExistingOracleInspectionRow = {
  oracle_case_id: string;
  market_id: string;
  case_type: OracleCaseType;
  market_status: OracleMarketContext["marketStatus"];
  case_status: "recommended" | "review_needed" | "no_action";
  ambiguity_level: OracleAmbiguityLevel | null;
  summary: string | null;
  scheduled_close_at: Date | null;
  current_winning_outcome_id: string | null;
  created_at: Date;
  updated_at: Date;
  evidence_packet_id: string;
  evidence_summary: string;
  sources_snapshot: unknown;
  captured_at: Date;
  winning_outcome_id: string | null;
  close_condition_satisfied: boolean | null;
  notes: string | null;
  output_snapshot: unknown;
};

function deriveCaseStatus(
  output: OracleRecommendationOutput
): "recommended" | "review_needed" | "no_action" {
  if (output.objectType === "oracle_review_signal") {
    return "review_needed";
  }

  if (
    output.objectType === "early_close_recommendation" &&
    output.recommendedAction === "take_no_action"
  ) {
    return "no_action";
  }

  return "recommended";
}

function readOutputId(output: OracleRecommendationOutput): string {
  switch (output.objectType) {
    case "early_close_recommendation":
      return output.earlyCloseRecommendationId;
    case "resolution_recommendation":
      return output.resolutionRecommendationId;
    case "oracle_review_signal":
      return output.oracleReviewSignalId;
  }
}

function readOutputType(output: OracleRecommendationOutput): string {
  return output.objectType;
}

function readJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  return [];
}

function readJsonObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }

  return {};
}

function toEvidenceSources(value: unknown): OracleEvidenceSource[] {
  return readJsonArray(value).map((source) => {
    const record = readJsonObject(source);

    return {
      sourceId: typeof record.sourceId === "string" ? record.sourceId : undefined,
      sourceUrl: String(record.sourceUrl ?? ""),
      sourceLabel: String(record.sourceLabel ?? ""),
      sourceType: String(record.sourceType ?? ""),
      independentGroupId:
        typeof record.independentGroupId === "string" ? record.independentGroupId : undefined,
      claimSummary: String(record.claimSummary ?? ""),
      capturedAt: String(record.capturedAt ?? "")
    };
  });
}

function toRecommendationOutput(value: unknown): OracleRecommendationOutput | null {
  const record = readJsonObject(value);
  const objectType = record.objectType;

  if (
    objectType === "early_close_recommendation" ||
    objectType === "resolution_recommendation" ||
    objectType === "oracle_review_signal"
  ) {
    return record as unknown as OracleRecommendationOutput;
  }

  return null;
}

function buildExistingInspectionResult(
  market: OracleMarketContext,
  row: ExistingOracleInspectionRow
): OracleInspectionResult | null {
  const output = toRecommendationOutput(row.output_snapshot);

  if (!output) {
    return null;
  }

  const winningOutcome = row.current_winning_outcome_id
    ? market.outcomes.find((outcome) => outcome.outcomeId === row.current_winning_outcome_id)
    : null;
  const oracleCase: OracleCase = {
    objectType: "oracle_case",
    oracleCaseId: row.oracle_case_id,
    marketId: row.market_id,
    marketStatus: row.market_status,
    caseType: row.case_type,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    scheduledCloseAt: row.scheduled_close_at?.toISOString(),
    currentWinningOutcomeKey: winningOutcome?.outcomeKey,
    ambiguityLevel: row.ambiguity_level ?? undefined,
    summary: row.summary ?? undefined
  };
  const evidencePacket: EvidencePacket = {
    objectType: "evidence_packet",
    evidencePacketId: row.evidence_packet_id,
    oracleCaseId: row.oracle_case_id,
    marketId: row.market_id,
    evidenceSummary: row.evidence_summary,
    sources: toEvidenceSources(row.sources_snapshot),
    capturedAt: row.captured_at.toISOString(),
    winningOutcomeKey: row.winning_outcome_id
      ? market.outcomes.find((outcome) => outcome.outcomeId === row.winning_outcome_id)?.outcomeKey
      : undefined,
    closeConditionSatisfied: row.close_condition_satisfied ?? undefined,
    notes: row.notes ?? undefined
  };

  return {
    objectType: "oracle_inspection_result",
    market,
    oracleCase,
    evidencePacket,
    output
  };
}

async function findExistingActiveInspectionResult(
  db: Queryable,
  market: OracleMarketContext,
  result: OracleInspectionResult,
  winningOutcomeId: string | null
): Promise<OracleInspectionResult | null> {
  const closeConditionSatisfied =
    result.evidencePacket.closeConditionSatisfied == null
      ? null
      : result.evidencePacket.closeConditionSatisfied;
  const queryResult = await db.query<ExistingOracleInspectionRow>(
    `
      select
        oc.id as oracle_case_id,
        oc.market_id,
        oc.case_type,
        oc.market_status,
        oc.case_status,
        oc.ambiguity_level,
        oc.summary,
        oc.scheduled_close_at,
        oc.current_winning_outcome_id,
        oc.created_at,
        oc.updated_at,
        ep.id as evidence_packet_id,
        ep.evidence_summary,
        ep.sources_snapshot,
        ep.captured_at,
        ep.winning_outcome_id,
        ep.close_condition_satisfied,
        ep.notes,
        oco.output_snapshot
      from oracle_cases oc
      join oracle_evidence_packets ep
        on ep.oracle_case_id = oc.id
      join oracle_case_outputs oco
        on oco.oracle_case_id = oc.id
      where oc.market_id = $1
        and oc.case_type = $2
        and oc.current_winning_outcome_id is not distinct from $3
        and ep.close_condition_satisfied is not distinct from $4
        and oco.output_type = $5
        and not exists (
          select 1
          from oracle_case_reviews ocr
          where ocr.oracle_case_id = oc.id
            and ocr.result_status = 'completed'
            and ocr.review_action in ('reject_case', 'request_more_evidence')
        )
      order by oc.created_at desc
      limit 1
    `,
    [
      market.marketId,
      result.oracleCase.caseType,
      winningOutcomeId,
      closeConditionSatisfied,
      readOutputType(result.output)
    ]
  );
  const row = queryResult.rows[0];

  return row ? buildExistingInspectionResult(market, row) : null;
}

async function insertOracleCase(
  db: Queryable,
  market: OracleMarketContext,
  oracleCase: OracleCase,
  output: OracleRecommendationOutput,
  winningOutcomeId: string | null
): Promise<void> {
  await db.query(
    `
      insert into oracle_cases (
        id,
        market_id,
        case_type,
        market_status,
        case_status,
        ambiguity_level,
        summary,
        scheduled_close_at,
        current_winning_outcome_id,
        source_policy_snapshot,
        created_at,
        updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
    `,
    [
      oracleCase.oracleCaseId,
      market.marketId,
      oracleCase.caseType,
      oracleCase.marketStatus,
      deriveCaseStatus(output),
      oracleCase.ambiguityLevel ?? null,
      oracleCase.summary ?? null,
      oracleCase.scheduledCloseAt ?? null,
      winningOutcomeId,
      JSON.stringify(market.oracleSourcePolicy ?? {}),
      oracleCase.createdAt,
      oracleCase.updatedAt
    ]
  );
}

async function insertEvidencePacket(
  db: Queryable,
  evidencePacket: EvidencePacket,
  winningOutcomeId: string | null
): Promise<void> {
  await db.query(
    `
      insert into oracle_evidence_packets (
        id,
        oracle_case_id,
        market_id,
        evidence_summary,
        sources_snapshot,
        captured_at,
        winning_outcome_id,
        close_condition_satisfied,
        notes
      )
      values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)
    `,
    [
      evidencePacket.evidencePacketId,
      evidencePacket.oracleCaseId,
      evidencePacket.marketId,
      evidencePacket.evidenceSummary,
      JSON.stringify(evidencePacket.sources),
      evidencePacket.capturedAt,
      winningOutcomeId,
      evidencePacket.closeConditionSatisfied ?? null,
      evidencePacket.notes ?? null
    ]
  );
}

async function insertOracleOutput(
  db: Queryable,
  output: OracleRecommendationOutput
): Promise<void> {
  await db.query(
    `
      insert into oracle_case_outputs (
        id,
        oracle_case_id,
        market_id,
        output_type,
        output_snapshot,
        created_at
      )
      values ($1, $2, $3, $4, $5::jsonb, $6)
    `,
    [
      readOutputId(output),
      output.oracleCaseId,
      output.marketId,
      output.objectType,
      JSON.stringify(output),
      output.createdAt
    ]
  );
}

function readWinningOutcomeId(result: OracleInspectionResult): string | null {
  if (result.output.objectType === "resolution_recommendation") {
    const winningOutcomeKey = result.output.winningOutcomeKey;

    return (
      result.market.outcomes.find(
        (outcome) => outcome.outcomeKey === winningOutcomeKey
      )?.outcomeId ?? null
    );
  }

  if (!result.oracleCase.currentWinningOutcomeKey) {
    return null;
  }

  return (
    result.market.outcomes.find(
      (outcome) => outcome.outcomeKey === result.oracleCase.currentWinningOutcomeKey
    )?.outcomeId ?? null
  );
}

export async function persistInspectionResult(
  pool: Pool,
  result: OracleInspectionResult
): Promise<OracleInspectionResult> {
  const winningOutcomeId = readWinningOutcomeId(result);
  const existing = await findExistingActiveInspectionResult(
    pool,
    result.market,
    result,
    winningOutcomeId
  );

  if (existing) {
    return existing;
  }

  await withTransaction(pool, async (client) => {
    await insertOracleCase(client, result.market, result.oracleCase, result.output, winningOutcomeId);
    await insertEvidencePacket(client, result.evidencePacket, winningOutcomeId);
    await insertOracleOutput(client, result.output);
  });

  return result;
}
