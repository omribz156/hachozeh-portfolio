import type { Queryable } from "../../back/src/platform-surface/oracle";

import type { OracleCaseType } from "./contracts";
import { normalizeOracleLimit } from "./oracle-options";

export type OracleCaseStatus = "recommended" | "review_needed" | "no_action";

export type OracleCaseRow = {
  oracle_case_id: string;
  market_id: string;
  market_title: string;
  case_type: OracleCaseType;
  market_status: "draft" | "open" | "closed" | "resolved" | "voided";
  case_status: OracleCaseStatus;
  ambiguity_level: "low" | "medium" | "high" | null;
  summary: string | null;
  scheduled_close_at: Date | null;
  created_at: Date;
  updated_at: Date;
  winning_outcome_id: string | null;
  winning_outcome_label: string | null;
  evidence_packet_id: string | null;
  evidence_summary: string | null;
  evidence_captured_at: Date | null;
  close_condition_satisfied: boolean | null;
  sources_snapshot: unknown;
  output_id: string | null;
  output_type: "early_close_recommendation" | "resolution_recommendation" | "oracle_review_signal" | null;
  output_snapshot: unknown;
  source_policy_snapshot: unknown;
};

export type OracleCaseReviewRow = {
  id: string;
  review_action:
    | "approve_close_condition"
    | "approve_resolution"
    | "reject_case"
    | "request_more_evidence";
  result_status: "attempted" | "completed" | "failed";
  actor_id: string;
  actor_role: "user" | "admin";
  review_note: string | null;
  idempotency_key: string;
  resolution_id: string | null;
  resolve_response_snapshot: unknown;
  failure_code: string | null;
  failure_message: string | null;
  created_at: Date;
  completed_at: Date | null;
  failed_at: Date | null;
};

export type TerminalReviewRow = {
  oracle_case_id: string;
  id: string;
  review_action:
    | "approve_close_condition"
    | "approve_resolution"
    | "reject_case"
    | "request_more_evidence";
  result_status: "completed";
  completed_at: Date | null;
  created_at: Date;
};

export type ReadOracleCasesOptions = {
  caseStatus?: OracleCaseStatus | "all";
  caseType?: OracleCaseType;
  marketId?: string;
  limit?: number;
};

const ORACLE_CASE_SELECT = `
  select
    oc.id as oracle_case_id,
    oc.market_id,
    m.title as market_title,
    oc.case_type,
    oc.market_status,
    oc.case_status,
    oc.ambiguity_level,
    oc.summary,
    oc.scheduled_close_at,
    oc.created_at,
    oc.updated_at,
    oc.current_winning_outcome_id as winning_outcome_id,
    mo.label as winning_outcome_label,
    oep.id as evidence_packet_id,
    oep.evidence_summary,
    oep.captured_at as evidence_captured_at,
    oep.close_condition_satisfied,
    oep.sources_snapshot,
    oco.id as output_id,
    oco.output_type,
    oco.output_snapshot,
    oc.source_policy_snapshot
  from oracle_cases oc
  join markets m
    on m.id = oc.market_id
  left join market_outcomes mo
    on mo.market_id = oc.market_id
   and mo.id = oc.current_winning_outcome_id
  left join oracle_evidence_packets oep
    on oep.oracle_case_id = oc.id
  left join oracle_case_outputs oco
    on oco.oracle_case_id = oc.id
`;

export async function readOracleCases(
  db: Queryable,
  options: ReadOracleCasesOptions
): Promise<OracleCaseRow[]> {
  const limit = normalizeOracleLimit(options.limit);
  const values: unknown[] = [];
  const where: string[] = [];

  if (options.caseStatus && options.caseStatus !== "all") {
    values.push(options.caseStatus);
    where.push(`oc.case_status = $${values.length}`);
  }

  if (options.caseType) {
    values.push(options.caseType);
    where.push(`oc.case_type = $${values.length}`);
  }

  if (options.marketId) {
    values.push(options.marketId);
    where.push(`oc.market_id = $${values.length}`);
  }

  values.push(limit);

  const result = await db.query<OracleCaseRow>(
    `
      ${ORACLE_CASE_SELECT}
      ${where.length > 0 ? `where ${where.join(" and ")}` : ""}
      order by oc.created_at desc
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

export async function readOracleCaseById(
  db: Queryable,
  oracleCaseId: string
): Promise<OracleCaseRow | null> {
  const result = await db.query<OracleCaseRow>(
    `
      ${ORACLE_CASE_SELECT}
      where oc.id = $1
      limit 1
    `,
    [oracleCaseId]
  );

  return result.rows[0] ?? null;
}

export async function readOracleCaseReviewRows(
  db: Queryable,
  oracleCaseId: string
): Promise<OracleCaseReviewRow[]> {
  const result = await db.query<OracleCaseReviewRow>(
    `
      select
        id,
        review_action,
        result_status,
        actor_id,
        actor_role,
        review_note,
        idempotency_key,
        resolution_id,
        resolve_response_snapshot,
        failure_code,
        failure_message,
        created_at,
        completed_at,
        failed_at
      from oracle_case_reviews
      where oracle_case_id = $1
      order by created_at desc
    `,
    [oracleCaseId]
  );

  return result.rows;
}

export async function readTerminalReviewRowsByCaseId(
  db: Queryable,
  oracleCaseIds: string[]
): Promise<TerminalReviewRow[]> {
  if (oracleCaseIds.length === 0) {
    return [];
  }

  const result = await db.query<TerminalReviewRow>(
    `
      select distinct on (oracle_case_id)
        oracle_case_id,
        id,
        review_action,
        result_status,
        completed_at,
        created_at
      from oracle_case_reviews
      where oracle_case_id = any($1::text[])
        and result_status = 'completed'
        and review_action in (
          'approve_close_condition',
          'approve_resolution',
          'reject_case',
          'request_more_evidence'
        )
      order by oracle_case_id, completed_at desc nulls last, created_at desc
    `,
    [oracleCaseIds]
  );

  return result.rows;
}
