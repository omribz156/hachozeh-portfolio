import type { Queryable } from "../db/client/pool";

export async function updateAccountBalance(
  client: Queryable,
  accountId: string,
  nextBalance: string
): Promise<void> {
  await client.query(
    `
      update accounts
      set balance_cached = $2,
          updated_at = now()
      where id = $1
    `,
    [accountId, nextBalance]
  );
}
