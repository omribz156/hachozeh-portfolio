import type {
  DiscoveryFeedRow,
  DiscoveryFeedItem,
  DiscoverySignal
} from "./types";

export type DiscoverySignalRank = {
  rank: number;
};

export type DiscoverySignalOptions = {
  hotRank?: DiscoverySignalRank | null;
  movement?: DiscoveryFeedItem["movement"] | null;
};

const NEW_MARKET_WINDOW_MS = 72 * 60 * 60 * 1000;
const CLOSING_SOON_WINDOW_MS = 24 * 60 * 60 * 1000;

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function isExplicitlyLiveNow(row: DiscoveryFeedRow): boolean {
  const contract = readObject(row.market_contract);
  const displayHints = readObject(contract.displayHints);
  const lifecycle = readObject(contract.lifecycle);
  const liveStatus =
    readString(displayHints.liveStatus) ??
    readString(displayHints.eventStatus) ??
    readString(lifecycle.liveStatus) ??
    readString(lifecycle.eventStatus);

  return liveStatus === "live_now" || liveStatus === "in_progress";
}

export function buildDiscoverySignals(
  firstRow: DiscoveryFeedRow,
  options: DiscoverySignalOptions = {}
): DiscoverySignal[] {
  const now = Date.now();
  const publishedAtMs = firstRow.published_at?.getTime() ?? 0;
  const closeInMs = firstRow.close_at.getTime() - now;

  if (firstRow.market_status !== "open") {
    return [];
  }

  if (isExplicitlyLiveNow(firstRow)) {
    return [
      {
        type: "live",
        tone: "live",
        label: "LIVE",
        reason: "event_live_now"
      }
    ];
  }

  if (options.movement) {
    return [
      {
        type: "moved",
        tone: "moved",
        label: "זז",
        reason: "price_movement",
        outcomeKey: options.movement.outcomeKey,
        window: options.movement.window,
        fromProbability: options.movement.fromProbability,
        toProbability: options.movement.toProbability,
        deltaPercent: options.movement.deltaPercent,
        absDeltaPercent: options.movement.absDeltaPercent
      }
    ];
  }

  if (options.hotRank) {
    return [
      {
        type: "hot",
        tone: "hot",
        label: "לוהט",
        reason: "recent_trade_activity",
        rank: options.hotRank.rank
      }
    ];
  }

  if (closeInMs > 0 && closeInMs <= CLOSING_SOON_WINDOW_MS) {
    return [
      {
        type: "closing",
        tone: "closing",
        label: "סוגר בקרוב",
        reason: "close_time"
      }
    ];
  }

  if (publishedAtMs > 0 && now - publishedAtMs <= NEW_MARKET_WINDOW_MS) {
    return [
      {
        type: "new",
        tone: "new",
        label: "חדש",
        reason: "published_recently"
      }
    ];
  }

  return [];
}
