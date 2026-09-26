import type { Queryable } from "../../back/src/platform-surface/oracle";

import { normalizeOracleSourcePolicy, parseOracleSourcePolicyHints } from "./source-policy-annotations";

type EligibleMarketRow = {
  id: string;
  title: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  close_at: Date;
  oracle_source_policy: unknown;
};

export type EligibleMarket = {
  marketId: string;
  marketTitle: string;
  marketStatus: "open" | "closed";
  closeAt: string;
  contractHints: ReturnType<typeof parseOracleSourcePolicyHints>;
};

export async function readEligibleMarkets(
  db: Queryable,
  marketStatusFilter: "open" | "closed" | "all"
): Promise<EligibleMarket[]> {
  const statuses =
    marketStatusFilter === "all" ? ["open", "closed"] : [marketStatusFilter];
  const result = await db.query<EligibleMarketRow>(
    `
      select
        id,
        title,
        status,
        close_at,
        oracle_source_policy
      from markets
      where status = any($1::text[])
      order by
        case when status = 'open' then 0 else 1 end,
        close_at asc,
        id asc
    `,
    [statuses]
  );

  return result.rows
    .filter(
      (row): row is EligibleMarketRow & { status: "open" | "closed" } =>
        (row.status === "open" || row.status === "closed") &&
        normalizeOracleSourcePolicy(row.oracle_source_policy) != null
    )
    .map((row) => {
      const policy = normalizeOracleSourcePolicy(row.oracle_source_policy);

      return {
        marketId: row.id,
        marketTitle: row.title,
        marketStatus: row.status,
        closeAt: row.close_at.toISOString(),
        contractHints: parseOracleSourcePolicyHints(policy)
      };
    });
}
