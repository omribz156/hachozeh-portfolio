import type { Queryable } from "../db/client/pool";

export type LedgerHeadRow = {
  sequence_number: string | number;
  transaction_hash: string;
};

export async function readLockedLedgerHead(client: Queryable): Promise<LedgerHeadRow | null> {
  await client.query("select pg_advisory_xact_lock(hashtext('navi_ledger_sequence'))");

  const result = await client.query<LedgerHeadRow>(
    `
      select sequence_number, transaction_hash
      from ledger_transactions
      order by sequence_number desc
      limit 1
      for update
    `
  );

  return result.rows[0] ?? null;
}
