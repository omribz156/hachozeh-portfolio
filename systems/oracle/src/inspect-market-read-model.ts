import { type Queryable, resolveOutcomeKey } from "../../back/src/platform-surface/oracle";
import type { OracleInspectionResult, OracleSourcePolicy } from "./contracts";
import { normalizeMarketContract } from "./source-adapter-contracts";
import {
  normalizeOracleSourcePolicy,
  parseOracleSourcePolicyHints
} from "./source-policy-annotations";
import { OracleInspectionError } from "./inspect-market-errors";

type MarketRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  title: string;
  close_at: Date;
  resolution_source: string;
  resolution_rules: string;
  oracle_source_policy: unknown;
  market_contract: unknown;
};

type OutcomeRow = {
  id: string;
  label: string;
  is_winner: boolean | null;
};

export type OracleMarketContext = {
  marketId: string;
  title: string;
  marketStatus: MarketRow["status"];
  scheduledCloseAt: string;
  resolutionSource: string;
  resolutionRules: string;
  oracleSourcePolicy: OracleSourcePolicy | null;
  contractHints: OracleInspectionResult["market"]["contractHints"];
  outcomes: Array<{
    outcomeId: string;
    outcomeKey: string;
    label: string;
    isWinner: boolean | null;
  }>;
};

export async function readMarketContext(
  db: Queryable,
  marketId: string
): Promise<OracleMarketContext> {
  const marketResult = await db.query<MarketRow>(
    `
      select
        id,
        status,
        title,
        close_at,
        resolution_source,
        resolution_rules,
        oracle_source_policy,
        market_contract
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );
  const market = marketResult.rows[0];

  if (!market) {
    throw new OracleInspectionError(`Market not found: ${marketId}`);
  }

  const outcomeResult = await db.query<OutcomeRow>(
    `
      select
        id,
        label,
        is_winner
      from market_outcomes
      where market_id = $1
      order by sort_order asc, id asc
    `,
    [marketId]
  );

  if (outcomeResult.rows.length === 0) {
    throw new OracleInspectionError(`Market has no outcomes: ${marketId}`);
  }

  const oracleSourcePolicy = normalizeOracleSourcePolicy(market.oracle_source_policy);
  const marketContract = normalizeMarketContract(market.market_contract);
  const outcomeKeyByLabel = new Map(
    (marketContract?.outcomeMap ?? [])
      .filter((item) => item.outcomeLabel && item.evidenceKey)
      .map((item) => [item.outcomeLabel!, item.evidenceKey!])
  );

  return {
    marketId: market.id,
    title: market.title,
    marketStatus: market.status,
    scheduledCloseAt: market.close_at.toISOString(),
    resolutionSource: market.resolution_source,
    resolutionRules: market.resolution_rules,
    oracleSourcePolicy,
    contractHints: parseOracleSourcePolicyHints(oracleSourcePolicy),
    outcomes: outcomeResult.rows.map((row) => ({
      outcomeId: row.id,
      outcomeKey: outcomeKeyByLabel.get(row.label) ?? resolveOutcomeKey(row.id) ?? row.id,
      label: row.label,
      isWinner: row.is_winner
    }))
  };
}
