import type { Queryable } from "../db/client/pool";
import { quantizeMoney, toDecimal } from "../shared/decimals";
import { readMarketCategoryMeta } from "../shared/market-category";
import { resolveCanonicalMarketKeyById } from "../shared/market-identity";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import {
  EFFECTIVE_REALIZATION_TYPE_SQL,
  EFFECTIVE_REALIZED_PNL_SQL,
  INCIDENT_COMPENSATION_LATERAL_JOIN
} from "../shared/incident-compensation";

const TRACK_RECORD_HIGHLIGHT_EVENT_LIMIT = 500;

type TrackRecordSummaryRow = {
  resolved_count: number;
  win_count: number;
};

type TrackRecordCategoryRow = {
  category_key: string | null;
  resolved_count: number;
  win_count: number;
};

type TrackRecordEventRow = {
  market_id: string;
  market_title: string;
  type: "resolution_win" | "resolution_loss";
  realized_pnl: string;
  resolved_at: Date;
};

type TrackRecordUserRow = {
  user_id: string;
  handle: string;
  display_name: string | null;
};

export class TrackRecordServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "TrackRecordServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

type TrackRecordCategoryBreakdown = {
  categoryKey: string;
  categoryLabel: string;
  accuracy: number;
  resolvedCount: number;
};

type TrackRecordHighlights = {
  longestWinStreak: number;
  biggestWin: {
    amount: string;
    marketKey: string;
    title: string;
    resolvedAt: string;
  } | null;
};

export type TrackRecordResponse = {
  handle: string | null;
  displayName: string;
  accuracy: number;
  resolvedCount: number;
  categoryBreakdown: TrackRecordCategoryBreakdown[];
  highlights: TrackRecordHighlights;
};

function calculateAccuracy(winCount: number, resolvedCount: number): number {
  if (resolvedCount <= 0) {
    return 0;
  }

  return Number((winCount / resolvedCount).toFixed(4));
}

function normalizeTrackRecordUserKey(value: string): string {
  const userKey = value.trim().replace(/^@/, "");
  if (!userKey) {
    throw new TrackRecordServiceError(400, "invalid_request", "user key is required.");
  }
  if (userKey.length > 120) {
    throw new TrackRecordServiceError(400, "invalid_request", "user key is too long.");
  }
  return userKey;
}

function presentCategory(
  categoryKey: string | null
): Pick<TrackRecordCategoryBreakdown, "categoryKey" | "categoryLabel"> {
  const categoryMeta = readMarketCategoryMeta(categoryKey);

  return {
    categoryKey: categoryKey ?? "uncategorized",
    categoryLabel: categoryMeta?.label ?? "כללי"
  };
}

function buildTrackRecordHighlights(rows: TrackRecordEventRow[]): TrackRecordHighlights {
  let currentWinStreak = 0;
  let longestWinStreak = 0;
  let biggestWin: TrackRecordHighlights["biggestWin"] = null;

  for (const row of rows) {
    if (row.type === "resolution_win") {
      currentWinStreak += 1;
      longestWinStreak = Math.max(longestWinStreak, currentWinStreak);

      const amount = toDecimal(row.realized_pnl);
      const currentBiggest = biggestWin ? toDecimal(biggestWin.amount) : null;
      if (amount.gt(0) && (!currentBiggest || amount.gt(currentBiggest))) {
        biggestWin = {
          amount: quantizeMoney(amount),
          marketKey: resolveCanonicalMarketKeyById(row.market_id) ?? row.market_id,
          title: row.market_title,
          resolvedAt: row.resolved_at.toISOString()
        };
      }
      continue;
    }

    currentWinStreak = 0;
  }

  return {
    longestWinStreak,
    biggestWin
  };
}

async function readTrackRecordUser(
  db: Queryable,
  userKey: string
): Promise<TrackRecordUserRow | null> {
  const result = await db.query<TrackRecordUserRow>(
    `
      select id as user_id, handle, display_name
      from users
      where handle = lower($1)
        and status = 'active'
        and privacy_erased_at is null
      limit 1
    `,
    [userKey]
  );

  return result.rows[0] ?? null;
}

export async function readUserTrackRecord(
  db: Queryable,
  userKey: string
): Promise<TrackRecordResponse> {
  const normalizedUserKey = normalizeTrackRecordUserKey(userKey);
  const user = await readTrackRecordUser(db, normalizedUserKey);

  if (!user) {
    throw new TrackRecordServiceError(404, "user_not_found", "User profile was not found.");
  }

  const userId = user.user_id;
  const [summaryResult, categoryResult, eventResult] = await Promise.all([
    db.query<TrackRecordSummaryRow>(
      `
        select
          count(*)::int as resolved_count,
          count(*) filter (where ${EFFECTIVE_REALIZATION_TYPE_SQL} = 'resolution_win')::int as win_count
        from realization_events re
        join markets m
          on m.id = re.market_id
         and m.status = 'resolved'
        left join market_resolutions mr
          on mr.id = re.resolution_id
        ${INCIDENT_COMPENSATION_LATERAL_JOIN}
        where re.user_id = $1
          and re.type in ('resolution_win', 'resolution_loss')
      `,
      [userId]
    ),
    db.query<TrackRecordCategoryRow>(
      `
        select
          m.category_key,
          count(*)::int as resolved_count,
          count(*) filter (where ${EFFECTIVE_REALIZATION_TYPE_SQL} = 'resolution_win')::int as win_count
        from realization_events re
        join markets m
          on m.id = re.market_id
         and m.status = 'resolved'
        left join market_resolutions mr
          on mr.id = re.resolution_id
        ${INCIDENT_COMPENSATION_LATERAL_JOIN}
        where re.user_id = $1
          and re.type in ('resolution_win', 'resolution_loss')
        group by m.category_key
        order by resolved_count desc, coalesce(m.category_key, 'uncategorized') asc
      `,
      [userId]
    ),
    db.query<TrackRecordEventRow>(
      `
        select
          m.id as market_id,
          m.title as market_title,
          ${EFFECTIVE_REALIZATION_TYPE_SQL} as type,
          ${EFFECTIVE_REALIZED_PNL_SQL}::text as realized_pnl,
          coalesce(m.resolved_at, re.created_at) as resolved_at
        from realization_events re
        join markets m
          on m.id = re.market_id
         and m.status = 'resolved'
        left join market_resolutions mr
          on mr.id = re.resolution_id
        ${INCIDENT_COMPENSATION_LATERAL_JOIN}
        where re.user_id = $1
          and re.type in ('resolution_win', 'resolution_loss')
        order by coalesce(m.resolved_at, re.created_at) asc, re.id asc
        limit $2
      `,
      [userId, TRACK_RECORD_HIGHLIGHT_EVENT_LIMIT]
    )
  ]);
  const summary = summaryResult.rows[0] ?? { resolved_count: 0, win_count: 0 };

  return {
    handle: user.handle,
    displayName: resolvePublicDisplayName(userId, user.display_name, user.handle),
    accuracy: calculateAccuracy(summary.win_count, summary.resolved_count),
    resolvedCount: summary.resolved_count,
    categoryBreakdown: categoryResult.rows.map((row) => {
      const category = presentCategory(row.category_key);

      return {
        ...category,
        accuracy: calculateAccuracy(row.win_count, row.resolved_count),
        resolvedCount: row.resolved_count
      };
    }),
    highlights: buildTrackRecordHighlights(eventResult.rows)
  };
}
