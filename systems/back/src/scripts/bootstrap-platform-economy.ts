import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { topUpPlatformTreasury } from "../economy/economy-ledger";
import {
  parseDecimalString,
  quantizeMoney,
  toDecimal
} from "../shared/decimals";
import { readStringArg } from "./script-args";

const DEFAULT_TARGET_BALANCE = "1000000000.000000";
const DEFAULT_REFERENCE_ID = "platform_economy_bootstrap";

function readTargetBalance(args: string[]): string {
  const raw = readStringArg(args, "target-balance", DEFAULT_TARGET_BALANCE);
  return quantizeMoney(parseDecimalString(raw, {
    fieldName: "target-balance",
    maxScale: 6
  }));
}

function readReferenceId(args: string[]): string {
  const value = readStringArg(args, "reference-id", DEFAULT_REFERENCE_ID).trim();
  if (!value) {
    throw new Error("reference-id must not be empty.");
  }
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const targetBalance = readTargetBalance(args);
  const referenceId = readReferenceId(args);
  const json = args.includes("--json");
  const pool = createDbPool(loadAppEnv().db);
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query(`
      insert into accounts (id, type, owner_id, status, balance_cached)
      values
        ('account_mint_source', 'mint_source', 'system', 'active', '0.000000'),
        ('account_platform_treasury', 'platform_treasury', 'platform', 'active', '0.000000'),
        ('account_sink', 'sink', 'system', 'active', '0.000000')
      on conflict (id) do nothing
    `);

    const treasuryResult = await client.query<{ balance: string }>(`
      select balance_cached::text as balance
      from accounts
      where type = 'platform_treasury'
        and status = 'active'
      order by created_at asc
      limit 1
      for update
    `);
    const currentBalance = quantizeMoney(treasuryResult.rows[0]?.balance ?? "0");
    const requestedDelta = toDecimal(targetBalance).minus(currentBalance);
    const delta = quantizeMoney(requestedDelta.gt(0) ? requestedDelta : 0);

    const existingTopUp = await client.query<{ id: string }>(
      `
        select id
        from ledger_transactions
        where reference_type = 'treasury_top_up'
          and reference_id = $1
        limit 1
      `,
      [referenceId]
    );

    let createdTopUp = false;
    if (toDecimal(delta).gt(0) && existingTopUp.rowCount === 0) {
      await topUpPlatformTreasury(client, {
        actorId: "system_platform_bootstrap",
        amount: delta,
        referenceId,
        idempotencyKey: referenceId,
        createdBy: "platform_economy_bootstrap"
      });
      createdTopUp = true;
    }

    await client.query("commit");

    const accounts = await pool.query<{
      type: string;
      id: string;
      status: string;
      balance: string;
    }>(`
      select type, id, status, balance_cached::text as balance
      from accounts
      where type in ('mint_source', 'platform_treasury', 'sink')
      order by type
    `);

    const response = {
      targetBalance,
      before: currentBalance,
      delta,
      createdTopUp,
      systemAccounts: accounts.rows
    };

    if (json) {
      console.log(JSON.stringify(response));
    } else {
      console.log(`platform economy bootstrap ok target=${targetBalance} before=${currentBalance} delta=${delta} topUp=${createdTopUp}`);
      for (const account of accounts.rows) {
        console.log(`${account.type} ${account.status} ${account.balance}`);
      }
    }
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
