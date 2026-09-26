import type { Pool } from "pg";

import type {
  MarketDetailEventChild,
  MarketDetailEventSummary
} from "../../../http/routes/market-detail-fixtures";
import { toDecimal } from "../../../shared/decimals";
import { readContractMarketImage } from "../../../shared/market-truth";
import { resolvePassiveOutcomeKey } from "./identity";
import { formatCloseLabel } from "./formatters";
import { formatVolumeLabel, parseVolumeDecimal } from "./volume-format";

type EventHeaderRow = {
  event_id: string | null;
};

type EventChildRow = {
  event_id: string;
  event_title: string;
  event_description: string | null;
  event_icon: string | null;
  event_status: string;
  resolution_policy: string;
  event_display_flags: Record<string, unknown> | null;
  market_id: string;
  market_status: string;
  event_child_label: string | null;
  title: string;
  market_contract: unknown;
  close_at: Date;
  outcome_id: string;
  outcome_label: string;
  outcome_short_label: string | null;
  sort_order: number;
  last_price: string;
  winning_outcome_id: string | null;
};

type EventChildTradeVolumeRow = {
  market_id: string;
  volume_amount: string;
};

type EventResolutionSource = {
  label: string | null;
  url: string | null;
};

type EventChildrenFingerprintRow = {
  child_count: string;
  max_state_version: string | null;
  max_updated_at: Date | null;
  event_display_flags: Record<string, unknown> | null;
};

export type MarketDetailEventChildrenPayload = {
  event: MarketDetailEventSummary;
  children: MarketDetailEventChild[];
  cacheFingerprint: string;
} | null;

function readOutcomeSide(label: string, sortOrder: number): "yes" | "no" | "outcome" {
  const normalized = label.trim().toLowerCase();

  if (normalized === "כן" || normalized === "yes") {
    return "yes";
  }

  if (normalized === "לא" || normalized === "no") {
    return "no";
  }

  return sortOrder === 0 ? "yes" : sortOrder === 1 ? "no" : "outcome";
}

function resolveCanonicalProbability(rows: EventChildRow[]): number | null {
  const yesRow =
    rows.find((row) => readOutcomeSide(row.outcome_label, row.sort_order) === "yes") ??
    rows[0];

  return yesRow ? Number(yesRow.last_price) : null;
}

function resolveWinner(rows: EventChildRow[]): string | null {
  const winningOutcomeId = rows[0]?.winning_outcome_id ?? null;

  if (!winningOutcomeId) {
    return null;
  }

  const winningRow = rows.find((row) => row.outcome_id === winningOutcomeId);

  if (!winningRow) {
    return null;
  }

  return readOutcomeSide(winningRow.outcome_label, winningRow.sort_order);
}

function buildChildLabel(row: EventChildRow): string {
  return row.event_child_label?.trim() || formatCloseLabel(row.close_at) || row.title;
}

function groupRowsByMarket(rows: EventChildRow[]): EventChildRow[][] {
  const grouped = new Map<string, EventChildRow[]>();

  for (const row of rows) {
    const marketRows = grouped.get(row.market_id) ?? [];
    marketRows.push(row);
    grouped.set(row.market_id, marketRows);
  }

  return [...grouped.values()];
}

function buildEventRulesLead(row: EventChildRow): string {
  const description = row.event_description?.trim();

  if (description) {
    return description;
  }

  return row.resolution_policy === "exclusive_first_hit"
    ? "האירוע מרכז כמה שווקים קשורים שרק אחד מהם יכול להיסגר כ\"כן\". כל שוק ברשימה מודד אפשרות אחרת בתוך אותו אירוע."
    : "האירוע מרכז כמה שווקים קשורים. כל שוק ברשימה מודד תרחיש נפרד, והתוצאה שלו נקבעת לפי כללי אותו שוק.";
}

function buildEventDelayPolicy(row: EventChildRow): string {
  if (row.resolution_policy === "exclusive_first_hit") {
    return "אחרי שתוצאה אחת מאומתת ומאושרת במערכת, שאר השווקים נסגרים לפי כללי האירוע. אם אין תוצאה מאומתת, השווקים נשארים פתוחים על פי ציר הזמן והכללים של האירוע.";
  }

  return "כל שוק בתוך האירוע מוכרע בנפרד לפי הכללים והמקורות שלו. האירוע כולו נשאר פעיל עד שכל השווקים נסגרים ונפתרים.";
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readContractResolutionSource(contract: unknown): EventResolutionSource | null {
  const source = readObject(readObject(contract)?.resolutionSource);

  if (!source) {
    return null;
  }

  const label = readString(source.label);
  const url = readString(source.url);

  return label || url ? { label, url } : null;
}

function buildSharedEventResolutionSource(
  groupedRows: EventChildRow[][]
): EventResolutionSource | null {
  const sources = groupedRows.map((marketRows) =>
    readContractResolutionSource(marketRows[0]?.market_contract)
  );

  if (!sources.length || sources.some((source) => !source)) {
    return null;
  }

  const [first] = sources;

  return sources.every((source) => source?.label === first?.label && source?.url === first?.url)
    ? first
    : null;
}

async function readSelectedEventId(pool: Pool, marketId: string): Promise<string | null> {
  const result = await pool.query<EventHeaderRow>(
    `
      select event_id
      from markets
      where id = $1
      limit 1
    `,
    [marketId]
  );

  return result.rows[0]?.event_id ?? null;
}

export async function readMarketDetailEventChildrenCacheFingerprint(
  pool: Pool,
  eventId: string | null
): Promise<string | null> {
  if (!eventId) {
    return null;
  }

  const result = await pool.query<EventChildrenFingerprintRow>(
    `
      select
        count(distinct m.id)::text as child_count,
        max(ps.version)::text as max_state_version,
        max(greatest(
          coalesce(ps.updated_at, m.updated_at, m.created_at),
          coalesce(m.updated_at, m.created_at)
        )) as max_updated_at,
        (select e.display_flags from events e where e.id = $1) as event_display_flags
      from markets m
      left join market_pricing_state ps
        on ps.market_id = m.id
      where m.event_id = $1
        and m.published_at is not null
    `,
    [eventId]
  );

  const row = result.rows[0];
  const childCount = Number(row?.child_count ?? 0);

  if (childCount <= 1) {
    return null;
  }

  // Include display_flags so flipping showGraph on a live event busts the cached
  // market-detail snapshot without a backend restart.
  const flagsKey = JSON.stringify(row?.event_display_flags ?? {});

  return `${eventId}:${childCount}:${row?.max_state_version ?? "na"}:${row?.max_updated_at?.toISOString() ?? "na"}:${flagsKey}`;
}

async function readEventChildRows(pool: Pool, eventId: string): Promise<EventChildRow[]> {
  const result = await pool.query<EventChildRow>(
    `
      select
        e.id as event_id,
        e.title as event_title,
        e.description as event_description,
        e.icon as event_icon,
        e.status as event_status,
        e.resolution_policy,
        e.display_flags as event_display_flags,
        m.id as market_id,
        case
          when m.status = 'open' and m.close_at <= now() then 'closed'
          else m.status
        end as market_status,
        m.event_child_label,
        m.title,
        m.market_contract,
        m.close_at,
        o.id as outcome_id,
        o.label as outcome_label,
        o.short_label as outcome_short_label,
        o.sort_order,
        os.last_price,
        mr.winning_outcome_id
      from events e
      join markets m
        on m.event_id = e.id
      join market_outcomes o
        on o.market_id = m.id
      join market_outcome_state os
        on os.market_id = m.id
       and os.outcome_id = o.id
      left join market_resolutions mr
        on mr.market_id = m.id
      where e.id = $1
        and m.published_at is not null
      order by
        case
          when m.status in ('open', 'closed') then 0
          when m.status = 'resolved' then 1
          else 2
        end asc,
        m.close_at asc,
        m.published_at asc,
        m.id asc,
        o.sort_order asc
    `,
    [eventId]
  );

  return result.rows;
}

async function readEventChildVolumes(
  pool: Pool,
  marketIds: string[]
): Promise<Map<string, ReturnType<typeof toDecimal>>> {
  if (!marketIds.length) {
    return new Map();
  }

  const result = await pool.query<EventChildTradeVolumeRow>(
    `
      select
        market_id,
        coalesce(sum(cash_amount), 0)::text as volume_amount
      from trades
      where market_id = any($1::text[])
      group by market_id
    `,
    [marketIds]
  );

  return new Map(
    result.rows.map((row) => [
      row.market_id,
      parseVolumeDecimal(row.volume_amount)
    ])
  );
}

export async function readMarketDetailEventChildren(
  pool: Pool,
  marketId: string
): Promise<MarketDetailEventChildrenPayload> {
  const eventId = await readSelectedEventId(pool, marketId);

  if (!eventId) {
    return null;
  }

  const rows = await readEventChildRows(pool, eventId);
  const groupedRows = groupRowsByMarket(rows);

  if (groupedRows.length <= 1) {
    return null;
  }

  const marketIds = groupedRows.map((marketRows) => marketRows[0]!.market_id);
  const volumeByMarketId = await readEventChildVolumes(pool, marketIds);
  const totalVolume = [...volumeByMarketId.values()].reduce(
    (sum, value) => sum.plus(value),
    toDecimal(0)
  );
  const firstRow = rows[0]!;
  const children = groupedRows.map((marketRows): MarketDetailEventChild => {
    const firstMarketRow = marketRows[0]!;
    const volume = volumeByMarketId.get(firstMarketRow.market_id) ?? toDecimal(0);

    return {
      marketId: firstMarketRow.market_id,
      label: buildChildLabel(firstMarketRow),
      status: firstMarketRow.market_status,
      canonicalProbability: resolveCanonicalProbability(marketRows),
      outcomes: marketRows.map((row) => ({
        side: readOutcomeSide(row.outcome_label, row.sort_order),
        label: row.outcome_short_label ?? row.outcome_label,
        price: Number(row.last_price),
        outcomeId: row.outcome_id,
        outcomeKey: resolvePassiveOutcomeKey(row.outcome_id)
      })),
      winner: resolveWinner(marketRows),
      volumeLabel: formatVolumeLabel(volume),
      crestPath: readContractMarketImage(firstMarketRow.market_contract)?.src ?? null,
      viewerPosition: null
    };
  });

  return {
    event: {
      id: firstRow.event_id,
      title: firstRow.event_title,
      description: firstRow.event_description,
      icon: firstRow.event_icon,
      status: firstRow.event_status,
      resolutionPolicy: firstRow.resolution_policy,
      rulesLead: buildEventRulesLead(firstRow),
      delayPolicy: buildEventDelayPolicy(firstRow),
      resolutionSource: buildSharedEventResolutionSource(groupedRows),
      childCount: groupedRows.length,
      volumeLabel: formatVolumeLabel(totalVolume),
      showGraph: firstRow.event_display_flags?.showGraph === true
    },
    children,
    cacheFingerprint: `${eventId}:${groupedRows.length}:${children
      .map(
        (child) =>
          `${child.marketId}:${child.status}:${child.label}:${child.volumeLabel}:${child.canonicalProbability ?? "na"}`
      )
      .join("|")}`
  };
}
