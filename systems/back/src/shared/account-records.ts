import type { Queryable } from "../db/client/pool";

export type AccountRecord = {
  id: string;
  type: string;
  status: string;
  balance_cached: string;
};

export async function readLockedAccountById(
  client: Queryable,
  accountId: string
): Promise<AccountRecord | null> {
  const result = await client.query<AccountRecord>(
    `
      select id, type, status, balance_cached
      from accounts
      where id = $1
      limit 1
      for update
    `,
    [accountId]
  );

  return result.rows[0] ?? null;
}

export async function readLockedPlatformTreasury(client: Queryable): Promise<AccountRecord | null> {
  const result = await client.query<AccountRecord>(
    `
      select id, type, status, balance_cached
      from accounts
      where type = 'platform_treasury'
      limit 1
      for update
    `
  );

  return result.rows[0] ?? null;
}
