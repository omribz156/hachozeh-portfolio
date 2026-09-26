import type { Queryable } from "../db/client/pool";

export type UserControlState = {
  userId: string;
  status: "active" | "locked" | "archived";
  role: "user" | "admin";
  tradeAccessStatus: "enabled" | "blocked";
};

type UserControlStateRow = {
  user_id: string;
  user_status: "active" | "locked" | "archived";
  user_role: "user" | "admin";
  trade_access_status: "enabled" | "blocked";
};

export async function readUserControlState(
  db: Queryable,
  userId: string
): Promise<UserControlState | null> {
  const result = await db.query<UserControlStateRow>(
    `
      select
        id as user_id,
        status as user_status,
        role as user_role,
        trade_access_status
      from users
      where id = $1
      limit 1
    `,
    [userId]
  );

  const row = result.rows[0];

  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    status: row.user_status,
    role: row.user_role,
    tradeAccessStatus: row.trade_access_status
  };
}
