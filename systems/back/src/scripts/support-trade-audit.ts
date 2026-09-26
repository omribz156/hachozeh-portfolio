import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import type { Queryable } from "../db/client/pool";

export type SupportTradeAuditOptions = {
  email: string | null;
  handle: string | null;
  userId: string | null;
  market: string | null;
  requestId: string | null;
  tradeId: string | null;
  limit: number;
  json: boolean;
};

type SupportTradeAuditRow = {
  audit_event_id: string;
  created_at: Date | string;
  actor_id: string;
  user_handle: string | null;
  user_display_name: string | null;
  trade_id: string;
  request_id: string | null;
  market_key: string | null;
  market_id: string | null;
  side: string | null;
  contract_side: string | null;
  outcome_key: string | null;
  outcome_id: string | null;
  execution_outcome_key: string | null;
  execution_outcome_id: string | null;
  quote_id: string | null;
  average_price: string | null;
  price_before: string | null;
  price_after: string | null;
  cash_spent: string | null;
  shares_bought: string | null;
  shares_sold: string | null;
  proceeds_received: string | null;
};

export type SupportTradeAuditEntry = {
  auditEventId: string;
  createdAt: string;
  user: {
    actorId: string;
    handle: string | null;
    displayName: string | null;
  };
  trade: {
    tradeId: string;
    requestId: string | null;
    marketKey: string | null;
    marketId: string | null;
    side: string | null;
    contractSide: string | null;
    requestedOutcomeKey: string | null;
    requestedOutcomeId: string | null;
    executionOutcomeKey: string | null;
    executionOutcomeId: string | null;
    quoteId: string | null;
  };
  economics: {
    averagePrice: string | null;
    priceBefore: string | null;
    priceAfter: string | null;
    cashSpent: string | null;
    sharesBought: string | null;
    sharesSold: string | null;
    proceedsReceived: string | null;
  };
};

export type SupportTradeAuditReport = {
  objectType: "support_trade_audit";
  generatedAt: string;
  filters: {
    emailLookup: boolean;
    handle: string | null;
    userId: string | null;
    market: string | null;
    requestId: string | null;
    tradeId: string | null;
    limit: number;
  };
  entries: SupportTradeAuditEntry[];
};

function readFlagValue(argv: string[], name: string): string | null {
  const prefix = `--${name}=`;
  const inline = argv.find((arg) => arg.startsWith(prefix));

  if (inline) {
    return inline.slice(prefix.length);
  }

  const index = argv.indexOf(`--${name}`);
  const next = index >= 0 ? argv[index + 1] : null;
  return next && !next.startsWith("--") ? next : null;
}

function readPositiveIntegerArg(argv: string[], name: string, fallback: number): number {
  const raw = readFlagValue(argv, name);

  if (raw === null) {
    return fallback;
  }

  if (!/^\d+$/.test(raw)) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
}

function normalizeHandle(value: string | null): string | null {
  const trimmed = value?.trim().replace(/^@/, "").toLowerCase() ?? "";
  return trimmed || null;
}

function normalizeText(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed || null;
}

export function parseSupportTradeAuditArgs(argv: string[]): SupportTradeAuditOptions {
  const options = {
    email: normalizeText(readFlagValue(argv, "email")),
    handle: normalizeHandle(readFlagValue(argv, "handle")),
    userId: normalizeText(readFlagValue(argv, "user-id")),
    market: normalizeText(readFlagValue(argv, "market")),
    requestId: normalizeText(readFlagValue(argv, "request-id")),
    tradeId: normalizeText(readFlagValue(argv, "trade-id")),
    limit: Math.min(readPositiveIntegerArg(argv, "limit", 25), 200),
    json: argv.includes("--json")
  };

  if (
    !options.email &&
    !options.handle &&
    !options.userId &&
    !options.requestId &&
    !options.tradeId
  ) {
    throw new Error(
      "Provide at least one support filter: --email, --handle, --user-id, --request-id, or --trade-id."
    );
  }

  return options;
}

function hasUserFilter(options: SupportTradeAuditOptions): boolean {
  return Boolean(options.email || options.handle || options.userId);
}

function mapRow(row: SupportTradeAuditRow): SupportTradeAuditEntry {
  return {
    auditEventId: row.audit_event_id,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    user: {
      actorId: row.actor_id,
      handle: row.user_handle,
      displayName: row.user_display_name
    },
    trade: {
      tradeId: row.trade_id,
      requestId: row.request_id,
      marketKey: row.market_key,
      marketId: row.market_id,
      side: row.side,
      contractSide: row.contract_side,
      requestedOutcomeKey: row.outcome_key,
      requestedOutcomeId: row.outcome_id,
      executionOutcomeKey: row.execution_outcome_key,
      executionOutcomeId: row.execution_outcome_id,
      quoteId: row.quote_id
    },
    economics: {
      averagePrice: row.average_price,
      priceBefore: row.price_before,
      priceAfter: row.price_after,
      cashSpent: row.cash_spent,
      sharesBought: row.shares_bought,
      sharesSold: row.shares_sold,
      proceedsReceived: row.proceeds_received
    }
  };
}

export async function readSupportTradeAudit(
  db: Queryable,
  options: SupportTradeAuditOptions
): Promise<SupportTradeAuditReport> {
  const result = await db.query<SupportTradeAuditRow>(
    `
      with target_users as (
        select distinct u.id
        from users u
        left join user_identities ui on ui.user_id = u.id
        where (
          $1::text is not null
          and (
            lower(ui.identifier_normalized) = lower($1)
            or lower(ui.identifier_display) = lower($1)
          )
        )
        or ($2::text is not null and u.handle = lower($2))
        or ($3::text is not null and u.id = $3)
      )
      select
        ae.id as audit_event_id,
        ae.created_at,
        ae.actor_id,
        u.handle as user_handle,
        u.display_name as user_display_name,
        coalesce(ae.payload->>'tradeId', ae.entity_id) as trade_id,
        ae.payload->>'requestId' as request_id,
        ae.payload->>'marketKey' as market_key,
        ae.payload->>'marketId' as market_id,
        ae.payload->>'side' as side,
        ae.payload->>'contractSide' as contract_side,
        ae.payload->>'outcomeKey' as outcome_key,
        ae.payload->>'outcomeId' as outcome_id,
        ae.payload->>'executionOutcomeKey' as execution_outcome_key,
        ae.payload->>'executionOutcomeId' as execution_outcome_id,
        ae.payload->>'quoteId' as quote_id,
        ae.payload->>'averagePrice' as average_price,
        ae.payload->>'priceBefore' as price_before,
        ae.payload->>'priceAfter' as price_after,
        ae.payload->>'cashSpent' as cash_spent,
        ae.payload->>'sharesBought' as shares_bought,
        ae.payload->>'sharesSold' as shares_sold,
        ae.payload->>'proceedsReceived' as proceeds_received
      from audit_events ae
      left join users u on u.id = ae.actor_id
      where ae.action = 'trade_executed'
        and ae.entity_type = 'trade'
        and (
          $4::boolean = false
          or ae.actor_id in (select id from target_users)
        )
        and ($5::text is null or ae.payload->>'marketKey' = $5 or ae.payload->>'marketId' = $5)
        and ($6::text is null or ae.payload->>'requestId' = $6)
        and ($7::text is null or ae.entity_id = $7 or ae.payload->>'tradeId' = $7)
      order by ae.created_at desc
      limit $8
    `,
    [
      options.email,
      options.handle,
      options.userId,
      hasUserFilter(options),
      options.market,
      options.requestId,
      options.tradeId,
      options.limit
    ]
  );

  return {
    objectType: "support_trade_audit",
    generatedAt: new Date().toISOString(),
    filters: {
      emailLookup: Boolean(options.email),
      handle: options.handle,
      userId: options.userId,
      market: options.market,
      requestId: options.requestId,
      tradeId: options.tradeId,
      limit: options.limit
    },
    entries: result.rows.map(mapRow)
  };
}

function formatTextReport(report: SupportTradeAuditReport): string {
  if (report.entries.length === 0) {
    return "support_trade_audit: no matching trade audit entries";
  }

  return report.entries
    .map((entry) => {
      const user = entry.user.handle ? `@${entry.user.handle}` : entry.user.actorId;
      return [
        `${entry.createdAt} ${entry.trade.tradeId}`,
        `user=${user}`,
        `requestId=${entry.trade.requestId ?? "-"}`,
        `market=${entry.trade.marketKey ?? entry.trade.marketId ?? "-"}`,
        `side=${entry.trade.side ?? "-"}`,
        `contractSide=${entry.trade.contractSide ?? "-"}`,
        `requested=${entry.trade.requestedOutcomeKey ?? entry.trade.requestedOutcomeId ?? "-"}`,
        `executed=${entry.trade.executionOutcomeKey ?? entry.trade.executionOutcomeId ?? "-"}`
      ].join(" ");
    })
    .join("\n");
}

export async function runSupportTradeAuditCli(
  options: SupportTradeAuditOptions
): Promise<SupportTradeAuditReport> {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    return await readSupportTradeAudit(pool, options);
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const options = parseSupportTradeAuditArgs(process.argv.slice(2));
  const report = await runSupportTradeAuditCli(options);

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log(formatTextReport(report));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
