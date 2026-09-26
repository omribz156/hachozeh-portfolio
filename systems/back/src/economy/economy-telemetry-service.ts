import type { Pool } from "pg";

import { ECONOMY_TIME_ZONE } from "./economy-config";
import { quantizeMoney, toDecimal } from "../shared/decimals";

export type EconomyTelemetryWindow = {
  from: Date;
  to: Date;
};

export type EconomyLedgerFlowRow = {
  localDate: string;
  type: string;
  transactionCount: number;
  entrySum: string;
};

export type EconomyFaucetFlowRow = {
  localDate: string;
  faucetType: string;
  claimCount: number;
  rewardTotal: string;
};

export type EconomyBalanceHistogramBucket = {
  bucket: string;
  userCount: number;
};

export type EconomyTelemetrySnapshot = {
  from: string;
  to: string;
  timeZone: string;
  ledgerFlowByType: EconomyLedgerFlowRow[];
  faucetFlow: EconomyFaucetFlowRow[];
  treasury: {
    platformTreasury: string | null;
    mintSource: string | null;
  };
  activeUsers: number;
  netGrantFlowPerActiveUser: string;
  balanceHistogram: EconomyBalanceHistogramBucket[];
};

type LedgerFlowDbRow = {
  local_date: string;
  type: string;
  transaction_count: number | string;
  entry_sum: string;
};

type FaucetFlowDbRow = {
  local_date: string;
  faucet_type: string;
  claim_count: number | string;
  reward_total: string;
};

type TreasuryDbRow = {
  type: string;
  balance_cached: string;
};

type ActiveUsersDbRow = {
  active_users: number | string;
};

type HistogramDbRow = {
  bucket: string;
  user_count: number | string;
};

function assertValidWindow(window: EconomyTelemetryWindow): void {
  if (!(window.from instanceof Date) || !Number.isFinite(window.from.getTime())) {
    throw new Error("Economy telemetry window.from must be a valid Date.");
  }

  if (!(window.to instanceof Date) || !Number.isFinite(window.to.getTime())) {
    throw new Error("Economy telemetry window.to must be a valid Date.");
  }

  if (window.from.getTime() >= window.to.getTime()) {
    throw new Error("Economy telemetry window.from must be before window.to.");
  }
}

function toCount(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function readLocalDate(value: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ECONOMY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));

  return `${byType["year"]}-${byType["month"]}-${byType["day"]}`;
}

function diffLocalCalendarDays(left: string, right: string): number {
  const leftMs = Date.UTC(
    Number(left.slice(0, 4)),
    Number(left.slice(5, 7)) - 1,
    Number(left.slice(8, 10))
  );
  const rightMs = Date.UTC(
    Number(right.slice(0, 4)),
    Number(right.slice(5, 7)) - 1,
    Number(right.slice(8, 10))
  );

  return Math.round((rightMs - leftMs) / 86_400_000);
}

function countWindowLocalDays(window: EconomyTelemetryWindow): number {
  const lastIncludedInstant = new Date(window.to.getTime() - 1);
  const fromLocalDate = readLocalDate(window.from);
  const toLocalDate = readLocalDate(lastIncludedInstant);

  return Math.max(1, diffLocalCalendarDays(fromLocalDate, toLocalDate) + 1);
}

function mapLedgerFlowRow(row: LedgerFlowDbRow): EconomyLedgerFlowRow {
  return {
    localDate: row.local_date,
    type: row.type,
    transactionCount: toCount(row.transaction_count),
    entrySum: quantizeMoney(row.entry_sum ?? "0")
  };
}

function mapFaucetFlowRow(row: FaucetFlowDbRow): EconomyFaucetFlowRow {
  return {
    localDate: row.local_date,
    faucetType: row.faucet_type,
    claimCount: toCount(row.claim_count),
    rewardTotal: quantizeMoney(row.reward_total ?? "0")
  };
}

function mapHistogramRow(row: HistogramDbRow): EconomyBalanceHistogramBucket {
  return {
    bucket: row.bucket,
    userCount: toCount(row.user_count)
  };
}

export function buildEconomyTelemetryWindow(days: number, now = new Date()): EconomyTelemetryWindow {
  const safeDays = Math.min(90, Math.max(1, Math.floor(days)));
  return {
    from: new Date(now.getTime() - safeDays * 24 * 60 * 60 * 1000),
    to: now
  };
}

export async function readEconomyTelemetry(
  db: Pool,
  window: EconomyTelemetryWindow
): Promise<EconomyTelemetrySnapshot> {
  assertValidWindow(window);

  const params = [window.from.toISOString(), window.to.toISOString(), ECONOMY_TIME_ZONE];
  const [
    ledgerResult,
    faucetResult,
    treasuryResult,
    activeUsersResult,
    histogramResult
  ] = await Promise.all([
    db.query<LedgerFlowDbRow>(
      `
        select
          to_char(lt.posted_at at time zone $3, 'YYYY-MM-DD') as local_date,
          lt.type,
          count(distinct lt.id)::int as transaction_count,
          coalesce(sum(le.amount) filter (where a.type = 'user_cash'), 0)::text as entry_sum
        from ledger_transactions lt
        join ledger_entries le
          on le.transaction_id = lt.id
        join accounts a
          on a.id = le.account_id
        where lt.posted_at >= $1::timestamptz
          and lt.posted_at < $2::timestamptz
        group by local_date, lt.type
        order by local_date, lt.type
      `,
      params
    ),
    db.query<FaucetFlowDbRow>(
      `
        select
          to_char(created_at at time zone $3, 'YYYY-MM-DD') as local_date,
          faucet_type,
          count(*)::int as claim_count,
          coalesce(sum(reward_amount), 0)::text as reward_total
        from faucet_claims
        where created_at >= $1::timestamptz
          and created_at < $2::timestamptz
        group by local_date, faucet_type
        order by local_date, faucet_type
      `,
      params
    ),
    db.query<TreasuryDbRow>(
      `
        select type, balance_cached::text as balance_cached
        from accounts
        where type in ('platform_treasury', 'mint_source')
        order by type
      `
    ),
    db.query<ActiveUsersDbRow>(
      `
        select count(distinct user_id)::int as active_users
        from sessions
        where last_seen_at >= $1::timestamptz
          and last_seen_at < $2::timestamptz
      `,
      [window.from.toISOString(), window.to.toISOString()]
    ),
    db.query<HistogramDbRow>(
      `
        select
          case
            when balance_cached < 100 then '0000-0099'
            when balance_cached < 500 then '0100-0499'
            when balance_cached < 1000 then '0500-0999'
            when balance_cached < 5000 then '1000-4999'
            when balance_cached < 10000 then '5000-9999'
            else '10000+'
          end as bucket,
          count(*)::int as user_count
        from accounts
        where type = 'user_cash'
          and status = 'active'
        group by bucket
        order by bucket
      `
    )
  ]);

  const platformTreasury = treasuryResult.rows.find((row) => row.type === "platform_treasury");
  const mintSource = treasuryResult.rows.find((row) => row.type === "mint_source");
  const activeUsers = toCount(activeUsersResult.rows[0]?.active_users);
  const grantFlow = ledgerResult.rows
    .filter((row) => row.type === "grant" || row.type === "treasury_top_up")
    .reduce((sum, row) => sum.plus(row.entry_sum ?? "0"), toDecimal(0));
  const windowDays = countWindowLocalDays(window);

  return {
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    timeZone: ECONOMY_TIME_ZONE,
    ledgerFlowByType: ledgerResult.rows.map(mapLedgerFlowRow),
    faucetFlow: faucetResult.rows.map(mapFaucetFlowRow),
    treasury: {
      platformTreasury: platformTreasury?.balance_cached ?? null,
      mintSource: mintSource?.balance_cached ?? null
    },
    activeUsers,
    netGrantFlowPerActiveUser: activeUsers > 0
      ? quantizeMoney(grantFlow.div(activeUsers).div(windowDays))
      : "0.000000",
    balanceHistogram: histogramResult.rows.map(mapHistogramRow)
  };
}
