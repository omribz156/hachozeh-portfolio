import type { Queryable } from "../db/client/pool";
import {
  readIntegritySignals,
  type IntegritySignal
} from "../risk/market-integrity-service";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import { maskEmail } from "./email-identity";

type AdminUserReadRow = {
  user_id: string;
  user_status: "active" | "locked" | "archived";
  user_role: "user" | "admin";
  trade_access_status: "enabled" | "blocked";
  lock_reason_code: string | null;
  locked_at: Date | null;
  created_at: Date;
  updated_at: Date;
  last_login_at: Date | null;
  identity_type: "email" | null;
  identifier_display: string | null;
  verified_at: Date | null;
  active_session_count: number;
  last_seen_at: Date | null;
};

type StarterGrantRow = {
  grant_transaction_id: string;
  grant_amount: string;
  grant_created_at: Date;
  reversal_transaction_id: string | null;
  reversal_amount: string | null;
  reversal_created_at: Date | null;
  reversal_reason: string | null;
};

type AdminAuditRow = {
  action: string;
  created_at: Date;
  actor_id: string;
};

type AccountSummaryRow = {
  balance_cached: string;
};

type PositionSummaryRow = {
  open_position_count: number;
  unresolved_position_count: number;
  portfolio_value: string;
  unresolved_position_value: string;
};

export type AdminUserReadResponse = {
  user: {
    userId: string;
    status: "active" | "locked" | "archived";
    role: "user" | "admin";
    tradeAccessStatus: "enabled" | "blocked";
    lockReasonCode: string | null;
    lockedAt: string | null;
    createdAt: string;
    updatedAt: string;
    lastLoginAt: string | null;
  };
  identity: {
    primary:
      | {
          channel: "email";
          identifierHint: string;
          verifiedAt: string | null;
        }
      | null;
  };
  sessions: {
    activeCount: number;
    lastSeenAt: string | null;
  };
  account: {
    availableCash: string | null;
    portfolioValue: string;
    totalAccountValue: string | null;
    openPositionsCount: number;
    unresolvedPositionsCount: number;
    unresolvedPositionValue: string;
  };
  archiveReadiness: {
    status: "clear" | "open_exposure";
    openPositionsCount: number;
    unresolvedPositionsCount: number;
    unresolvedPositionValue: string;
  };
  starterGrant: {
    status: "missing" | "granted" | "reversed";
    grantTransactionId: string | null;
    grantAmount: string | null;
    grantedAt: string | null;
    reversalTransactionId: string | null;
    reversalAmount: string | null;
    reversedAt: string | null;
    reversalReason: string | null;
  };
  recentAdminOps: Array<{
    action: string;
    createdAt: string;
    actorId: string;
  }>;
  recentRiskSignals: IntegritySignal[];
};

export async function readAdminUser(
  db: Queryable,
  userId: string
): Promise<AdminUserReadResponse | null> {
  const userResult = await db.query<AdminUserReadRow>(
    `
      select
        u.id as user_id,
        u.status as user_status,
        u.role as user_role,
        u.trade_access_status,
        u.lock_reason_code,
        u.locked_at,
        u.created_at,
        u.updated_at,
        u.last_login_at,
        identity.type as identity_type,
        identity.identifier_display,
        identity.verified_at,
        session_summary.active_session_count,
        session_summary.last_seen_at
      from users u
      left join lateral (
        select
          ui.type,
          ui.identifier_display,
          ui.verified_at
        from user_identities ui
        where ui.user_id = u.id
          and ui.status = 'active'
        order by ui.verified_at desc nulls last, ui.created_at asc
        limit 1
      ) identity
        on true
      left join lateral (
        select
          count(*)::int as active_session_count,
          max(s.last_seen_at) as last_seen_at
        from sessions s
        where s.user_id = u.id
          and s.status = 'active'
      ) session_summary
        on true
      where u.id = $1
      limit 1
    `,
    [userId]
  );

  const row = userResult.rows[0];

  if (!row) {
    return null;
  }

  const [
    cashAccountResult,
    positionSummaryResult,
    starterGrantResult,
    adminAuditResult,
    riskSignalsResult
  ] = await Promise.all([
    db.query<AccountSummaryRow>(
      `
          select balance_cached
          from accounts
          where type = 'user_cash'
            and owner_id = $1
          limit 1
        `,
      [userId]
    ),
    db.query<PositionSummaryRow>(
      `
          select
            count(*)::int as open_position_count,
            count(*) filter (where m.status <> 'resolved')::int as unresolved_position_count,
            coalesce(sum((p.shares::numeric * os.last_price::numeric)), 0)::text as portfolio_value,
            coalesce(
              sum(
                case
                  when m.status <> 'resolved' then (p.shares::numeric * os.last_price::numeric)
                  else 0
                end
              ),
              0
            )::text as unresolved_position_value
          from positions p
          join markets m
            on m.id = p.market_id
          join market_outcome_state os
            on os.market_id = p.market_id
           and os.outcome_id = p.outcome_id
          where p.user_id = $1
        `,
      [userId]
    ),
    db.query<StarterGrantRow>(
      `
        select
          g.id as grant_transaction_id,
          le_user.amount as grant_amount,
          g.created_at as grant_created_at,
          rev.id as reversal_transaction_id,
          rev_comp.amount as reversal_amount,
          rev.created_at as reversal_created_at,
          rev.compensation_reason as reversal_reason
        from ledger_transactions g
        join ledger_entries le_user
          on le_user.transaction_id = g.id
         and le_user.entry_role = 'credit_user_cash'
        left join lateral (
          select
            id,
            created_at,
            compensation_reason
          from ledger_transactions
          where compensates_transaction_id = g.id
          order by sequence_number asc
          limit 1
        ) rev
          on true
        left join ledger_entries rev_comp
          on rev_comp.transaction_id = rev.id
         and rev_comp.entry_role = 'debit_user_cash'
        where g.reference_type = 'grant'
          and g.reference_id = $1
        order by g.sequence_number asc
        limit 1
      `,
      [`starter_bonus:${userId}`]
    ),
    db.query<AdminAuditRow>(
      `
        select
          action,
          created_at,
          actor_id
        from audit_events
        where entity_type = 'user'
          and entity_id = $1
          and action like 'admin.user.%'
        order by created_at desc
        limit 5
      `,
      [userId]
    ),
    readIntegritySignals(db, {
      subject: userId,
      limit: 5
    })
  ]);

  const cashAccountRow = cashAccountResult.rows[0] ?? null;
  const positionSummaryRow = positionSummaryResult.rows[0] ?? {
    open_position_count: 0,
    unresolved_position_count: 0,
    portfolio_value: "0",
    unresolved_position_value: "0"
  };
  const starterGrantRow = starterGrantResult.rows[0] ?? null;
  const recentAdminOps = adminAuditResult.rows.map((auditRow) => ({
    action: auditRow.action,
    createdAt: auditRow.created_at.toISOString(),
    actorId: auditRow.actor_id
  }));
  const availableCash = cashAccountRow
    ? quantizeMoney(cashAccountRow.balance_cached)
    : null;
  const portfolioValue = quantizeMoney(positionSummaryRow.portfolio_value);
  const unresolvedPositionValue = quantizeMoney(positionSummaryRow.unresolved_position_value);
  const totalAccountValue = availableCash
    ? quantizeMoney(toDecimal(availableCash).plus(portfolioValue))
    : null;
  const unresolvedPositionsCount = positionSummaryRow.unresolved_position_count;
  const openPositionsCount = positionSummaryRow.open_position_count;
  const archiveReadinessStatus =
    unresolvedPositionsCount > 0 ? "open_exposure" : "clear";

  return {
    user: {
      userId: row.user_id,
      status: row.user_status,
      role: row.user_role,
      tradeAccessStatus: row.trade_access_status,
      lockReasonCode: row.lock_reason_code,
      lockedAt: row.locked_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      lastLoginAt: row.last_login_at?.toISOString() ?? null
    },
    identity: {
      primary:
        row.identity_type === "email" && row.identifier_display
          ? {
              channel: "email",
              identifierHint: maskEmail(row.identifier_display),
              verifiedAt: row.verified_at?.toISOString() ?? null
            }
          : null
    },
    sessions: {
      activeCount: row.active_session_count,
      lastSeenAt: row.last_seen_at?.toISOString() ?? null
    },
    account: {
      availableCash,
      portfolioValue,
      totalAccountValue,
      openPositionsCount,
      unresolvedPositionsCount,
      unresolvedPositionValue
    },
    archiveReadiness: {
      status: archiveReadinessStatus,
      openPositionsCount,
      unresolvedPositionsCount,
      unresolvedPositionValue
    },
    starterGrant: starterGrantRow
      ? {
          status: starterGrantRow.reversal_transaction_id ? "reversed" : "granted",
          grantTransactionId: starterGrantRow.grant_transaction_id,
          grantAmount: starterGrantRow.grant_amount,
          grantedAt: starterGrantRow.grant_created_at.toISOString(),
          reversalTransactionId: starterGrantRow.reversal_transaction_id,
          reversalAmount: starterGrantRow.reversal_amount,
          reversedAt: starterGrantRow.reversal_created_at?.toISOString() ?? null,
          reversalReason: starterGrantRow.reversal_reason
        }
      : {
          status: "missing",
          grantTransactionId: null,
          grantAmount: null,
          grantedAt: null,
          reversalTransactionId: null,
          reversalAmount: null,
          reversedAt: null,
          reversalReason: null
        },
    recentAdminOps,
    recentRiskSignals: riskSignalsResult.signals
  };
}
