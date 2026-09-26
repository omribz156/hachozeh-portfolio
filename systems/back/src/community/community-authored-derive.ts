// Server-side derivation for authored position/result/milestone posts. The
// author picks a market they actually traded (or a milestone they actually
// earned); the numbers come from their real contract_positions /
// realization_events / stats — never from the client. Returns null when the
// author has nothing real to share, so the write is rejected (can't fake it).
import type { Queryable } from "../db/client/pool";
import { resolveMarketId, readMarketKey } from "../markets/market-api/identity";
import { readMarketCategoryMeta } from "../shared/market-category";

export type PositionMeta = { side: "buy" | "sell"; amount: number; outcomeLabel: string };
export type ResultMeta = { resultKind: "win" | "loss"; pnl: number; entry: number | null; outcomeLabel: string };
export type MilestoneMeta = { badge: string; icon: string };

// The author's open position on a market → the numbers a "position" post freezes.
export async function derivePosition(db: Queryable, userId: string, marketKey: string): Promise<PositionMeta | null> {
  const marketId = resolveMarketId(marketKey);
  const r = await db.query<{ contract_side: string; cost_basis: string; short_label: string | null; label: string | null }>(
    `
      select cp.contract_side, cp.cost_basis::text as cost_basis, o.short_label, o.label
      from contract_positions cp
      left join market_outcomes o on o.market_id = cp.market_id and o.id = cp.requested_outcome_id
      where cp.user_id = $1 and cp.market_id = $2 and cp.shares > 0
      order by cp.last_trade_at desc nulls last
      limit 1
    `,
    [userId, marketId]
  );
  const row = r.rows[0];
  if (!row) return null;
  return {
    side: row.contract_side === "no" ? "sell" : "buy",
    amount: Math.round(Number(row.cost_basis) || 0),
    outcomeLabel: row.short_label || row.label || ""
  };
}

// The author's resolution on a market → the numbers a "result" post freezes.
export async function deriveResult(db: Queryable, userId: string, marketKey: string): Promise<ResultMeta | null> {
  const marketId = resolveMarketId(marketKey);
  const r = await db.query<{
    net_pnl: string;
    shares_closed: string;
    removed_cost_basis: string;
    outcome_short: string | null;
    outcome_label: string | null;
  }>(
    `
      select
        sum(re.realized_pnl)::text as net_pnl,
        sum(re.shares_closed)::text as shares_closed,
        sum(re.removed_cost_basis)::text as removed_cost_basis,
        max(o.short_label) as outcome_short,
        max(o.label) as outcome_label
      from realization_events re
      left join market_outcomes o on o.market_id = re.market_id and o.id = re.outcome_id
      where re.user_id = $1 and re.market_id = $2
        and re.type in ('resolution_win', 'resolution_loss')
      having sum(re.shares_closed) > 0
    `,
    [userId, marketId]
  );
  const row = r.rows[0];
  if (!row) return null;
  const pnl = Math.round(Number(row.net_pnl) || 0);
  const shares = Number(row.shares_closed) || 0;
  const cost = Number(row.removed_cost_basis) || 0;
  // entry price % = average cost per share (bounded 1..99)
  const entry = shares > 0 ? Math.max(1, Math.min(99, Math.round((cost / shares) * 100))) : null;
  return {
    resultKind: pnl >= 0 ? "win" : "loss",
    pnl,
    entry,
    outcomeLabel: row.outcome_short || row.outcome_label || ""
  };
}

// ── milestones (no achievements table → derive from what's verifiable) ────────
// A shareable milestone the author has actually earned: their verification tier,
// or an accuracy tier once they have enough resolved history.
export type ShareableMilestone = { id: string; badge: string; icon: string };

export async function readShareableMilestones(db: Queryable, userId: string): Promise<ShareableMilestone[]> {
  const out: ShareableMilestone[] = [];

  const tier = await db.query<{ tier: string }>(
    `select tier from user_verification_tier_purchases where user_id = $1 order by purchased_at desc limit 1`,
    [userId]
  );
  const t = tier.rows[0]?.tier;
  if (t) {
    const label = t === "diamond" ? "יהלום" : t === "gold" ? "זהב" : "מאומת";
    out.push({ id: `tier:${t}`, badge: `דרגת ${label}`, icon: "workspace_premium" });
  }

  const stats = await db.query<{ resolved: string; wins: string }>(
    `
      select count(*)::text as resolved,
        count(*) filter (where type = 'resolution_win')::text as wins
      from realization_events
      where user_id = $1 and type in ('resolution_win', 'resolution_loss')
    `,
    [userId]
  );
  const resolved = Number(stats.rows[0]?.resolved || 0);
  const wins = Number(stats.rows[0]?.wins || 0);
  if (resolved >= 10) {
    const acc = Math.round((wins / resolved) * 100);
    out.push({ id: `accuracy:${acc}`, badge: `דיוק ${acc}% על ${resolved} הכרעות`, icon: "target" });
  }
  return out;
}

export async function deriveMilestone(db: Queryable, userId: string, milestoneId: string): Promise<MilestoneMeta | null> {
  const list = await readShareableMilestones(db, userId);
  const m = list.find((x) => x.id === milestoneId);
  return m ? { badge: m.badge, icon: m.icon } : null;
}

// Composer pickers: the author's own open positions / resolved markets, with the
// derived preview numbers already attached (so the picker IS the preview).
export type MyPositionRow = { marketKey: string; title: string; cat: string; side: "buy" | "sell"; amount: number; outcomeLabel: string };
export type MyResultRow = { marketKey: string; title: string; cat: string; resultKind: "win" | "loss"; pnl: number; entry: number | null; outcomeLabel: string };

export async function readMyPositions(db: Queryable, userId: string, limit = 20): Promise<MyPositionRow[]> {
  const r = await db.query<{
    market_id: string; title: string; category_key: string | null;
    contract_side: string; cost_basis: string; outcome_short: string | null; outcome_label: string | null;
  }>(
    `
      select cp.market_id, m.title, m.category_key, cp.contract_side, cp.cost_basis::text as cost_basis,
        o.short_label as outcome_short, o.label as outcome_label
      from contract_positions cp
      join markets m on m.id = cp.market_id and m.published_at is not null
      left join market_outcomes o on o.market_id = cp.market_id and o.id = cp.requested_outcome_id
      where cp.user_id = $1 and cp.shares > 0
      order by cp.last_trade_at desc nulls last
      limit $2
    `,
    [userId, limit]
  );
  return r.rows.map((row) => ({
    marketKey: readMarketKey(row.market_id),
    title: row.title,
    cat: readMarketCategoryMeta(row.category_key)?.label ?? "שוק",
    side: row.contract_side === "no" ? "sell" : "buy",
    amount: Math.round(Number(row.cost_basis) || 0),
    outcomeLabel: row.outcome_short || row.outcome_label || ""
  }));
}

export async function readMyResults(db: Queryable, userId: string, limit = 20): Promise<MyResultRow[]> {
  const r = await db.query<{
    market_id: string; title: string; category_key: string | null;
    net_pnl: string; shares_closed: string; removed_cost_basis: string; outcome_short: string | null; outcome_label: string | null;
  }>(
    `
      select re.market_id, m.title, m.category_key,
        sum(re.realized_pnl)::text as net_pnl,
        sum(re.shares_closed)::text as shares_closed,
        sum(re.removed_cost_basis)::text as removed_cost_basis,
        max(o.short_label) as outcome_short, max(o.label) as outcome_label
      from realization_events re
      join markets m on m.id = re.market_id
      left join market_outcomes o on o.market_id = re.market_id and o.id = re.outcome_id
      where re.user_id = $1 and re.type in ('resolution_win', 'resolution_loss')
      group by re.market_id, m.title, m.category_key
      having sum(re.shares_closed) > 0
      order by max(re.created_at) desc
      limit $2
    `,
    [userId, limit]
  );
  return r.rows.map((row) => {
    const pnl = Math.round(Number(row.net_pnl) || 0);
    const shares = Number(row.shares_closed) || 0;
    const cost = Number(row.removed_cost_basis) || 0;
    return {
      marketKey: readMarketKey(row.market_id),
      title: row.title,
      cat: readMarketCategoryMeta(row.category_key)?.label ?? "שוק",
      resultKind: pnl >= 0 ? "win" : "loss",
      pnl,
      entry: shares > 0 ? Math.max(1, Math.min(99, Math.round((cost / shares) * 100))) : null,
      outcomeLabel: row.outcome_short || row.outcome_label || ""
    };
  });
}
