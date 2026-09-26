import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { quantizeMoney, toDecimal } from "../shared/decimals";

type Options = {
  market?: string;
  correctWinningOutcomeId?: string;
  json?: boolean;
};

async function run(options: Options): Promise<void> {
  const marketId = options.market?.trim();
  if (!marketId) {
    throw new Error("--market is required.");
  }

  const pool = createDbPool(loadAppEnv().db);
  try {
    const market = (
      await pool.query(
        `
          select
            m.id,
            m.title,
            m.status,
            m.settlement_status,
            mr.winning_outcome_id,
            mo.label as winner_label
          from markets m
          left join market_resolutions mr on mr.market_id = m.id
          left join market_outcomes mo on mo.market_id = m.id and mo.id = mr.winning_outcome_id
          where m.id = $1
          limit 1
        `,
        [marketId]
      )
    ).rows[0] ?? null;

    const realized = (
      await pool.query(
        `
          select
            re.type,
            re.outcome_id,
            mo.label as outcome_label,
            count(*)::int as row_count,
            count(distinct re.user_id)::int as user_count,
            sum(re.shares_closed)::numeric(20, 6)::text as shares_closed,
            sum(re.proceeds)::numeric(20, 6)::text as proceeds,
            sum(re.removed_cost_basis)::numeric(20, 6)::text as removed_cost_basis
          from realization_events re
          join market_outcomes mo on mo.market_id = re.market_id and mo.id = re.outcome_id
          where re.market_id = $1
            and re.type in ('resolution_win', 'resolution_loss')
          group by re.type, re.outcome_id, mo.label
          order by re.type, mo.label
        `,
        [marketId]
      )
    ).rows;

    const candidates = options.correctWinningOutcomeId
      ? (
          await pool.query<{
            user_id: string;
            realization_event_id: string;
            shares_closed: string;
            actual_proceeds: string;
            already_compensated: boolean;
          }>(
            `
              select
                re.user_id,
                re.id as realization_event_id,
                re.shares_closed::numeric(20, 6)::text as shares_closed,
                re.proceeds::numeric(20, 6)::text as actual_proceeds,
                exists (
                  select 1
                  from ledger_transactions lt
                  where lt.reference_type = 'market_incident_compensation'
                    and lt.reference_id = 'market_incident_compensation:' || re.market_id || ':' || re.id
                ) as already_compensated
              from realization_events re
              where re.market_id = $1
                and re.outcome_id = $2
                and re.type = 'resolution_loss'
            `,
            [marketId, options.correctWinningOutcomeId]
          )
        ).rows
      : [];

    const compensationTotal = candidates.reduce((sum, candidate) => {
      if (candidate.already_compensated) return sum;
      const amount = toDecimal(candidate.shares_closed).minus(candidate.actual_proceeds);
      return amount.gt(0) ? sum.plus(amount) : sum;
    }, toDecimal(0));

    const receipt = {
      objectType: "market_incident_impact",
      generatedAt: new Date().toISOString(),
      market,
      correctWinningOutcomeId: options.correctWinningOutcomeId ?? null,
      realizationSummary: realized,
      compensationCandidateCount: candidates.length,
      uncompensatedCandidateCount: candidates.filter((candidate) => !candidate.already_compensated).length,
      estimatedCompensationTotal: quantizeMoney(compensationTotal)
    };

    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
  } finally {
    await pool.end();
  }
}

const program = new Command("market-incident-impact")
  .description("Read-only incident impact report before compensation/reopen decisions.")
  .requiredOption("--market <market-id>")
  .option("--correct-winning-outcome-id <outcome-id>")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
