import { resolve as resolvePath } from "node:path";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { readOptionalPositiveIntegerArg, readStringArg } from "./script-args";

type Format = "human" | "json";

type SnapshotOptions = {
  format: Format;
  windowHours: number;
  topLimit: number;
};

type UserSnapshotRow = {
  total_users: number;
  active_users: number;
  admin_users: number;
  users_window: number;
  users_today_utc: number;
  logged_in_window: number;
  identities: number;
  users_with_identity: number;
  total_sessions: number;
  active_sessions: number;
  users_with_active_session: number;
  otp_window: number;
  otp_consumed_window: number;
};

type MovementSnapshotRow = {
  trade_count: number;
  unique_traders: number;
  traded_markets: number;
  total_trade_volume_vshekel: string;
  trades_window: number;
  unique_traders_window: number;
  trade_volume_window_vshekel: string;
  first_trade_at: Date | null;
  last_trade_at: Date | null;
  open_contract_position_rows: number;
  users_with_open_contract_positions: number;
  open_cost_basis_vshekel: string;
  visible_comments: number;
  visible_comments_window: number;
  commenters: number;
  market_saves: number;
  market_savers: number;
  notifications: number;
  visible_unread_notifications: number;
  ledger_tx_count: number;
  gross_ledger_entry_movement_vshekel: string;
};

type MarketStatusRow = {
  status: string;
  count: number;
};

type TopMarketRow = {
  id: string;
  title: string;
  status: string;
  trades: number;
  traders: number;
  volume_vshekel: string;
  last_trade_at: Date | null;
};

type LedgerByTypeRow = {
  type: string;
  tx_count: number;
  user_cash_delta_vshekel: string;
  gross_entry_movement_vshekel: string;
};

export type PlatformUsageSnapshot = {
  generatedAt: string;
  windowHours: number;
  users: UserSnapshotRow;
  movement: MovementSnapshotRow;
  marketStatus: MarketStatusRow[];
  topMarkets: TopMarketRow[];
  ledgerByType: LedgerByTypeRow[];
};

function readFormat(args: string[]): Format {
  const raw = args.includes("--json") ? "json" : readStringArg(args, "format", "human");

  if (raw === "human" || raw === "json") {
    return raw;
  }

  throw new Error("--format must be human or json");
}

function readBoundedInteger(args: string[], name: string, fallback: number, max: number): number {
  const parsed = readOptionalPositiveIntegerArg(args, name) ?? fallback;

  return Math.min(max, parsed);
}

export function parsePlatformUsageSnapshotOptions(
  args = process.argv.slice(2)
): SnapshotOptions {
  return {
    format: readFormat(args),
    windowHours: readBoundedInteger(args, "window-hours", 24, 24 * 30),
    topLimit: readBoundedInteger(args, "limit", 10, 50)
  };
}

function iso(value: Date | string | null): string | null {
  if (!value) {
    return null;
  }

  return value instanceof Date ? value.toISOString() : value;
}

function money(value: string | number | null | undefined): string {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed.toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0
  }) : String(value ?? "0");
}

export async function readPlatformUsageSnapshot(
  options: Pick<SnapshotOptions, "windowHours" | "topLimit">
): Promise<PlatformUsageSnapshot> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);
  const windowHours = options.windowHours;

  try {
    const [
      clock,
      users,
      movement,
      marketStatus,
      topMarkets,
      ledgerByType
    ] = await Promise.all([
      pool.query<{ db_now: Date }>("select now() as db_now"),
      pool.query<UserSnapshotRow>(
        `
          select
            count(*)::int as total_users,
            count(*) filter (where status = 'active')::int as active_users,
            count(*) filter (where role = 'admin')::int as admin_users,
            count(*) filter (where created_at >= now() - ($1::int * interval '1 hour'))::int as users_window,
            count(*) filter (where created_at >= date_trunc('day', now()))::int as users_today_utc,
            count(*) filter (where last_login_at >= now() - ($1::int * interval '1 hour'))::int as logged_in_window,
            (select count(*)::int from user_identities) as identities,
            (select count(distinct user_id)::int from user_identities) as users_with_identity,
            (select count(*)::int from sessions) as total_sessions,
            (select count(*)::int from sessions where status = 'active' and expires_at > now()) as active_sessions,
            (select count(distinct user_id)::int from sessions where status = 'active' and expires_at > now()) as users_with_active_session,
            (select count(*)::int from otp_challenges where created_at >= now() - ($1::int * interval '1 hour')) as otp_window,
            (select count(*)::int from otp_challenges where consumed_at >= now() - ($1::int * interval '1 hour')) as otp_consumed_window
          from users
        `,
        [windowHours]
      ),
      pool.query<MovementSnapshotRow>(
        `
          select
            (select count(*)::int from trades) as trade_count,
            (select count(distinct user_id)::int from trades) as unique_traders,
            (select count(distinct market_id)::int from trades) as traded_markets,
            (select coalesce(sum(cash_amount), 0)::numeric(20,6)::text from trades) as total_trade_volume_vshekel,
            (select count(*)::int from trades where created_at >= now() - ($1::int * interval '1 hour')) as trades_window,
            (select count(distinct user_id)::int from trades where created_at >= now() - ($1::int * interval '1 hour')) as unique_traders_window,
            (select coalesce(sum(cash_amount), 0)::numeric(20,6)::text from trades where created_at >= now() - ($1::int * interval '1 hour')) as trade_volume_window_vshekel,
            (select min(created_at) from trades) as first_trade_at,
            (select max(created_at) from trades) as last_trade_at,
            (select count(*)::int from contract_positions) as open_contract_position_rows,
            (select count(distinct user_id)::int from contract_positions) as users_with_open_contract_positions,
            (select coalesce(sum(cost_basis), 0)::numeric(20,6)::text from contract_positions) as open_cost_basis_vshekel,
            (select count(*)::int from market_comments where status = 'visible') as visible_comments,
            (select count(*)::int from market_comments where status = 'visible' and created_at >= now() - ($1::int * interval '1 hour')) as visible_comments_window,
            (select count(distinct user_id)::int from market_comments where status = 'visible') as commenters,
            (select count(*)::int from user_market_saves) as market_saves,
            (select count(distinct user_id)::int from user_market_saves) as market_savers,
            (select count(*)::int from user_notifications) as notifications,
            (select count(*)::int from user_notifications where read_at is null and dismissed_at is null) as visible_unread_notifications,
            (select count(*)::int from ledger_transactions) as ledger_tx_count,
            (select coalesce(sum(abs(amount)), 0)::numeric(20,6)::text from ledger_entries) as gross_ledger_entry_movement_vshekel
        `,
        [windowHours]
      ),
      pool.query<MarketStatusRow>(
        `
          select status, count(*)::int as count
          from markets
          where market_environment = 'prod'
          group by status
          order by status
        `
      ),
      pool.query<TopMarketRow>(
        `
          select
            m.id,
            m.title,
            m.status,
            count(t.id)::int as trades,
            count(distinct t.user_id)::int as traders,
            coalesce(sum(t.cash_amount), 0)::numeric(20,6)::text as volume_vshekel,
            max(t.created_at) as last_trade_at
          from markets m
          left join trades t
            on t.market_id = m.id
          where m.market_environment = 'prod'
          group by m.id, m.title, m.status
          order by coalesce(sum(t.cash_amount), 0) desc, count(t.id) desc, m.created_at desc
          limit $1
        `,
        [options.topLimit]
      ),
      pool.query<LedgerByTypeRow>(
        `
          select
            lt.type,
            count(distinct lt.id)::int as tx_count,
            coalesce(sum(le.amount) filter (where a.type = 'user_cash'), 0)::numeric(20,6)::text as user_cash_delta_vshekel,
            coalesce(sum(abs(le.amount)), 0)::numeric(20,6)::text as gross_entry_movement_vshekel
          from ledger_transactions lt
          join ledger_entries le
            on le.transaction_id = lt.id
          join accounts a
            on a.id = le.account_id
          group by lt.type
          order by abs(coalesce(sum(le.amount) filter (where a.type = 'user_cash'), 0)) desc,
            coalesce(sum(abs(le.amount)), 0) desc
        `
      )
    ]);

    return {
      generatedAt: clock.rows[0]?.db_now.toISOString() ?? new Date().toISOString(),
      windowHours,
      users: users.rows[0],
      movement: movement.rows[0],
      marketStatus: marketStatus.rows,
      topMarkets: topMarkets.rows,
      ledgerByType: ledgerByType.rows
    };
  } finally {
    await pool.end();
  }
}

function renderStatus(rows: MarketStatusRow[]): string {
  return rows.length
    ? rows.map((row) => `${row.status}=${row.count}`).join(", ")
    : "none";
}

export function renderPlatformUsageSnapshot(snapshot: PlatformUsageSnapshot): string {
  const { users, movement } = snapshot;
  const lines = [
    `platform-usage snapshot`,
    `generated: ${snapshot.generatedAt}`,
    `window: ${snapshot.windowHours}h`,
    "",
    `users: total=${users.total_users}, active=${users.active_users}, admins=${users.admin_users}`,
    `users: new_window=${users.users_window}, logged_in_window=${users.logged_in_window}, active_session_users=${users.users_with_active_session}`,
    `auth: identities=${users.identities}, sessions=${users.total_sessions}, active_sessions=${users.active_sessions}, otp_window=${users.otp_window}, otp_consumed_window=${users.otp_consumed_window}`,
    "",
    `markets: ${renderStatus(snapshot.marketStatus)}`,
    `trades: count=${movement.trade_count}, traders=${movement.unique_traders}, markets=${movement.traded_markets}, volume=${money(movement.total_trade_volume_vshekel)} V₪`,
    `trades_window: count=${movement.trades_window}, traders=${movement.unique_traders_window}, volume=${money(movement.trade_volume_window_vshekel)} V₪`,
    `positions: rows=${movement.open_contract_position_rows}, users=${movement.users_with_open_contract_positions}, cost_basis=${money(movement.open_cost_basis_vshekel)} V₪`,
    `social: comments=${movement.visible_comments}, comments_window=${movement.visible_comments_window}, commenters=${movement.commenters}, saves=${movement.market_saves}, notifications=${movement.notifications}, unread_visible=${movement.visible_unread_notifications}`,
    `ledger: tx=${movement.ledger_tx_count}, gross_entry_movement=${money(movement.gross_ledger_entry_movement_vshekel)} V₪`,
    `trade_time: first=${iso(movement.first_trade_at) ?? "none"}, last=${iso(movement.last_trade_at) ?? "none"}`,
    "",
    "top_markets:"
  ];

  if (!snapshot.topMarkets.length) {
    lines.push("  none");
  } else {
    for (const row of snapshot.topMarkets) {
      lines.push(
        `  ${row.title} [${row.status}] trades=${row.trades}, traders=${row.traders}, volume=${money(row.volume_vshekel)} V₪, last=${iso(row.last_trade_at) ?? "none"}`
      );
    }
  }

  lines.push("", "ledger_by_type:");
  if (!snapshot.ledgerByType.length) {
    lines.push("  none");
  } else {
    for (const row of snapshot.ledgerByType) {
      lines.push(
        `  ${row.type}: tx=${row.tx_count}, user_cash_delta=${money(row.user_cash_delta_vshekel)} V₪, gross_entries=${money(row.gross_entry_movement_vshekel)} V₪`
      );
    }
  }

  lines.push("", "privacy: aggregate-only; no user ids, emails, session ids, or comments.");

  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = parsePlatformUsageSnapshotOptions();
  const snapshot = await readPlatformUsageSnapshot(options);

  if (options.format === "json") {
    console.log(JSON.stringify(snapshot, null, 2));
    return;
  }

  console.log(renderPlatformUsageSnapshot(snapshot));
}

const currentScriptPath = process.argv[1] ? resolvePath(process.argv[1]) : "";

if (
  currentScriptPath.endsWith("platform-usage-snapshot.ts") ||
  currentScriptPath.endsWith("platform-usage-snapshot.js")
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
