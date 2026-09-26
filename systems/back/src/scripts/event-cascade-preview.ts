import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { planDependentResolutionCascade } from "../lifecycle/events/dependent-resolution-cascade-planner";
import { planEventSiblingResolutionCascade } from "../lifecycle/events/event-sibling-cascade-planner";

type Options = {
  market?: string;
  winningOutcomeId?: string;
  case?: string;
  json?: boolean;
};

type CaseRow = {
  oracle_case_id: string;
  market_id: string;
  event_id: string | null;
  winning_outcome_id: string | null;
};

type MarketRow = {
  id: string;
  event_id: string | null;
};

async function readCase(input: { pool: ReturnType<typeof createDbPool>; caseId: string }): Promise<CaseRow | null> {
  return (
    await input.pool.query<CaseRow>(
      `
        select
          oc.id as oracle_case_id,
          oc.market_id,
          m.event_id,
          oc.current_winning_outcome_id as winning_outcome_id
        from oracle_cases oc
        join markets m on m.id = oc.market_id
        where oc.id = $1
        limit 1
      `,
      [input.caseId]
    )
  ).rows[0] ?? null;
}

async function readMarket(input: { pool: ReturnType<typeof createDbPool>; marketId: string }): Promise<MarketRow | null> {
  return (
    await input.pool.query<MarketRow>(
      `
        select id, event_id
        from markets
        where id = $1
        limit 1
      `,
      [input.marketId]
    )
  ).rows[0] ?? null;
}

async function run(options: Options): Promise<void> {
  const pool = createDbPool(loadAppEnv().db);
  try {
    let marketId = options.market?.trim() || "";
    let winningOutcomeId = options.winningOutcomeId?.trim() || "";
    let eventId: string | null = null;
    let oracleCaseId: string | null = null;

    if (options.case) {
      const row = await readCase({ pool, caseId: options.case.trim() });
      if (!row) {
        throw new Error(`Oracle case not found: ${options.case}`);
      }
      marketId = row.market_id;
      winningOutcomeId = winningOutcomeId || row.winning_outcome_id || "";
      eventId = row.event_id;
      oracleCaseId = row.oracle_case_id;
    }

    if (!marketId) {
      throw new Error("--market or --case is required.");
    }
    if (!winningOutcomeId) {
      throw new Error("--winning-outcome-id is required unless --case provides one.");
    }

    const market = await readMarket({ pool, marketId });
    if (!market) {
      throw new Error(`Market not found: ${marketId}`);
    }
    eventId = eventId ?? market.event_id;

    const trigger = {
      triggerMarketId: marketId,
      triggerWinningOutcomeId: winningOutcomeId,
      approvedByHuman: true,
      oracleCaseId,
      reviewId: null
    };

    const eventSiblingCascade = eventId
      ? await planEventSiblingResolutionCascade(pool, eventId, trigger)
      : null;
    const dependentResolutionCascade = await planDependentResolutionCascade(pool, trigger);

    const receipt = {
      objectType: "event_cascade_preview",
      generatedAt: new Date().toISOString(),
      marketId,
      eventId,
      oracleCaseId,
      winningOutcomeId,
      eventSiblingCascade,
      dependentResolutionCascade,
      summary: {
        siblingActionCount: eventSiblingCascade?.siblingActions.length ?? 0,
        dependentActionCount: dependentResolutionCascade.dependentActions.length,
        blockerCount:
          (eventSiblingCascade?.blockers.length ?? 0) + dependentResolutionCascade.blockers.length
      }
    };

    console.log(JSON.stringify(receipt, null, options.json ? 2 : 2));
    if (receipt.summary.blockerCount > 0) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

const program = new Command("event-cascade-preview")
  .description("Read-only cascade blast-radius preview for approving a resolution on an event child.")
  .option("--case <oracle-case-id>")
  .option("--market <market-id>")
  .option("--winning-outcome-id <outcome-id>")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
