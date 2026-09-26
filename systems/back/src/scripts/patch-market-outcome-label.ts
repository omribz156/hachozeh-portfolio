import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";

type PatchPayload = {
  market?: string;
  outcomeId?: string;
  fromLabel?: string;
  toLabel?: string;
  dryRun?: boolean;
};

type Options = PatchPayload & {
  payloadJsonB64?: string;
  json?: boolean;
};

type OutcomeRow = {
  id: string;
  market_id: string;
  label: string;
  short_label: string | null;
};

function readPayload(options: Options): Required<Pick<PatchPayload, "market" | "toLabel">> & PatchPayload {
  let payload: PatchPayload = { ...options };

  if (options.payloadJsonB64) {
    const decoded = Buffer.from(options.payloadJsonB64, "base64").toString("utf8");
    payload = { ...payload, ...JSON.parse(decoded) };
  }

  const market = payload.market?.trim();
  const toLabel = payload.toLabel?.trim();
  const outcomeId = payload.outcomeId?.trim();
  const fromLabel = payload.fromLabel?.trim();

  if (!market) {
    throw new Error("--market is required.");
  }

  if (!toLabel) {
    throw new Error("--to-label is required.");
  }

  if (!outcomeId && !fromLabel) {
    throw new Error("Use --outcome-id or --from-label to identify the outcome.");
  }

  return {
    ...payload,
    market,
    toLabel,
    ...(outcomeId ? { outcomeId } : {}),
    ...(fromLabel ? { fromLabel } : {})
  };
}

async function run(options: Options): Promise<void> {
  const payload = readPayload(options);
  const pool = createDbPool(loadAppEnv().db);

  try {
    const client = await pool.connect();
    try {
      await client.query("begin");

      const result = await client.query<OutcomeRow>(
        `
          select id, market_id, label, short_label
          from market_outcomes
          where market_id = $1
            and ($2::text is null or id = $2)
            and ($3::text is null or label = $3 or short_label = $3)
          order by sort_order asc, id asc
          for update
        `,
        [payload.market, payload.outcomeId ?? null, payload.fromLabel ?? null]
      );

      if (result.rows.length === 0) {
        await client.query("rollback");
        const failure = {
          objectType: "market_outcome_label_patch",
          status: "missing_outcome",
          marketId: payload.market,
          outcomeId: payload.outcomeId ?? null,
          fromLabel: payload.fromLabel ?? null,
          toLabel: payload.toLabel
        };
        console.log(JSON.stringify(failure, null, 2));
        process.exitCode = 2;
        return;
      }

      if (result.rows.length > 1) {
        await client.query("rollback");
        throw new Error(`Outcome selector matched ${result.rows.length} rows. Use --outcome-id.`);
      }

      const before = result.rows[0];
      let after: OutcomeRow = before;

      if (!payload.dryRun && (before.label !== payload.toLabel || before.short_label !== payload.toLabel)) {
        const update = await client.query<OutcomeRow>(
          `
            update market_outcomes
            set
              label = $3,
              short_label = $3,
              updated_at = now()
            where market_id = $1
              and id = $2
            returning id, market_id, label, short_label
          `,
          [payload.market, before.id, payload.toLabel]
        );
        after = update.rows[0] ?? before;

        await client.query("update markets set updated_at = now() where id = $1", [payload.market]);
        await client.query("update market_pricing_state set updated_at = now() where market_id = $1", [
          payload.market
        ]);
      }

      if (payload.dryRun) {
        await client.query("rollback");
      } else {
        await client.query("commit");
      }

      const receipt = {
        objectType: "market_outcome_label_patch",
        status: payload.dryRun ? "dry_run" : "patched",
        marketId: payload.market,
        outcomeId: before.id,
        before,
        after
      };

      console.log(JSON.stringify(receipt, null, 2));
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

const program = new Command("patch-market-outcome-label")
  .description("Patch a market outcome label and short label with a receipt-backed DB update.")
  .option("--market <market-id>")
  .option("--outcome-id <outcome-id>")
  .option("--from-label <label>")
  .option("--to-label <label>")
  .option("--payload-json-b64 <base64-json>")
  .option("--dry-run")
  .option("--json")
  .action(run);

program.parseAsync(process.argv).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
