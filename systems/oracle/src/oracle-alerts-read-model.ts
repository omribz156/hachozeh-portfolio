import type { Queryable } from "../../back/src/platform-surface/oracle";

import { normalizeOracleSourcePolicy, parseOracleSourcePolicyHints } from "./source-policy-annotations";

export {
  readEligibleMarkets,
  type EligibleMarket
} from "./oracle-eligible-markets-read-model";

type OracleCasePressureRow = {
  oracle_case_id: string;
  market_id: string;
  case_type: "close_condition_check" | "resolution_check";
  case_status: "recommended" | "review_needed" | "no_action";
  market_status: "draft" | "open" | "closed" | "resolved" | "voided";
  scheduled_close_at: Date | null;
  created_at: Date;
  updated_at: Date;
  source_policy_snapshot: unknown;
};

export type OracleCasePressure = {
  oracleCaseId: string;
  marketId: string;
  caseType: "close_condition_check" | "resolution_check";
  caseStatus: "recommended" | "review_needed" | "no_action";
  marketStatus: "draft" | "open" | "closed" | "resolved" | "voided";
  scheduledCloseAt: string | null;
  createdAt: string;
  updatedAt: string;
  contractHints: ReturnType<typeof parseOracleSourcePolicyHints>;
};

export async function readLatestOracleCases(
  db: Queryable,
  marketIds: string[]
): Promise<OracleCasePressure[]> {
  if (marketIds.length === 0) {
    return [];
  }

  const result = await db.query<OracleCasePressureRow>(
    `
      select distinct on (oc.market_id, oc.case_type)
        oc.id as oracle_case_id,
        oc.market_id,
        oc.case_type,
        oc.case_status,
        oc.market_status,
        oc.scheduled_close_at,
        oc.created_at,
        oc.updated_at,
        oc.source_policy_snapshot
      from oracle_cases oc
      where oc.market_id = any($1::text[])
      order by
        oc.market_id asc,
        oc.case_type asc,
        oc.updated_at desc,
        oc.created_at desc
    `,
    [marketIds]
  );

  return result.rows.map((row) => {
    const policy = normalizeOracleSourcePolicy(row.source_policy_snapshot);

    return {
      oracleCaseId: row.oracle_case_id,
      marketId: row.market_id,
      caseType: row.case_type,
      caseStatus: row.case_status,
      marketStatus: row.market_status,
      scheduledCloseAt: row.scheduled_close_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      contractHints: parseOracleSourcePolicyHints(policy)
    };
  });
}
