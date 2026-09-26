export type DiscoveryFeedName = "trending" | "new" | "breaking" | "closing";

export type DiscoveryMarketShape = "binary" | "matchup" | "multi" | "live";

export type DiscoveryOutcomeRole =
  | "yes"
  | "no"
  | "side_a"
  | "side_b"
  | "draw"
  | "up"
  | "down";

export type DiscoverySignalType = "live" | "hot" | "moved" | "breaking" | "closing" | "new";

export type DiscoverySignal = {
  type: DiscoverySignalType;
  tone: "live" | "hot" | "moved" | "breaking" | "closing" | "new";
  label: string;
  reason:
    | "event_live_now"
    | "recent_trade_activity"
    | "price_movement"
    | "breaking_news"
    | "close_time"
    | "published_recently";
  rank?: number;
  outcomeKey?: string;
  window?: "24h";
  fromProbability?: string;
  toProbability?: string;
  deltaPercent?: number;
  absDeltaPercent?: number;
};

// Team brand hydrated onto a matchup card at read time (display state, never
// stamped). Resolved by the presenter from the registry per side; null when the
// side's label matches no seeded team. See
// workspace/docs/superpowers/specs/2026-06-01-sports-team-colors-design.md.
export type DiscoverySportsTeam = {
  outcomeKey: string;
  displayName: string;
  shortName: string;
  colorPrimary: string;
  colorOn: string;
  crestLabel: string;
  colorSecondary?: string; // jersey tile background
  crestPath?: string; // served path to the team jersey SVG
};

export type DiscoverySportsGame = {
  sport: {
    key: string;
    label: string;
  } | null;
  league: {
    key: string;
    label: string;
  } | null;
  sourceIds: string[];
  resultShape: string | null;
  matchupKind: "two_way" | "three_way" | "unknown";
  hasDraw: boolean;
};

export type DiscoveryFeedRow = {
  market_id: string;
  event_id?: string | null;
  event_slug?: string | null;
  event_title?: string | null;
  event_icon?: string | null;
  event_display_flags?: Record<string, unknown> | null;
  event_child_label?: string | null;
  discovery_event_child_card?: boolean;
  discovery_shape?: DiscoveryMarketShape | null;
  market_status: string;
  persisted_status?: string | null;
  title: string;
  description: string | null;
  category_key: string | null;
  published_at: Date | null;
  open_at: Date;
  close_at: Date;
  settlement_status: string | null;
  market_resolved_at: Date | null;
  resolution_source: string | null;
  resolution_rules: string | null;
  market_contract: unknown;
  winning_outcome_id: string | null;
  winning_outcome_label: string | null;
  resolution_source_url: string | null;
  resolution_note: string | null;
  resolution_resolved_at: Date | null;
  updated_at: Date;
  recent_trade_count?: number | string | null;
  recent_trade_volume?: string | null;
  outcome_count: number;
  total_volume: string;
  outcome_id: string;
  outcome_label: string;
  outcome_short_label: string | null;
  outcome_image_url: string | null;
  sort_order: number;
  last_price: string;
};

export type DiscoveryMovementRow = {
  market_id: string;
  outcome_id: string;
  window_key: "24h";
  from_price: string;
  to_price: string;
  delta: string;
  abs_delta: string;
  trade_count: number;
  trade_volume: string;
};

export type DiscoveryViewerPositionRow = {
  market_id: string;
  outcome_id: string;
  contract_side: "yes" | "no";
  shares: string;
  cost_basis: string;
  current_price: string;
};

export type DiscoveryFeedItem = {
  feedKey: string;
  marketKey: string;
  href: string;
  event: {
    eventKey: string;
    eventSlug: string | null;
    publicPath: string | null;
    parentKey: string;
    representativeMarketKey: string;
    childMarketKeys: string[];
  } | null;
  marketStatus: string;
  shape: DiscoveryMarketShape;
  title: string;
  description: string | null;
  category: {
    key: string | null;
    label: string;
  };
  closeAt: string;
  closeLabel: string;
  updatedAt: string;
  updatedLabel: string;
  publishedAt: string | null;
  settlementStatus: string | null;
  resolvedAt: string | null;
  lifecycle: {
    openAt: string;
    closeAt: string;
    expectedResolutionAt: string | null;
    publishedAt: string | null;
    updatedAt: string;
    resolvedAt: string | null;
    persistedStatus: string;
    effectiveStatus: string;
    settlementStatus: string | null;
    payoutPolicy: unknown;
  };
  winner: {
    outcomeId: string;
    outcomeKey: string;
    label: string;
  } | null;
  result: {
    status: string;
    settlementStatus: string | null;
    resolvedAt: string | null;
    winner: {
      outcomeId: string;
      outcomeKey: string;
      label: string;
    } | null;
    source: {
      label: string | null;
      url: string | null;
      rules: string | null;
      explanation: string | null;
    };
  };
  trust?: {
    resolutionSource: string | null;
    sourceUrl: string | null;
    resolutionRules: string | null;
    contract?: unknown;
  };
  image: {
    // src: the SVG icon (or legacy outcome/category image). Always present.
    src: string;
    alt: string;
    // photoSrc: optional editorial photograph hydrated from the registry asset
    // (registry.json → assets[].photoPath). Surfaces that earn a photo (hero
    // slide) render this; card thumbs always render `src`. See
    // docs/agents/seer/market-image-taxonomy-v1.md "Photo Doctrine".
    photoSrc?: string;
    theme?: unknown;
  } | null;
  // sportsTeams is present only on matchup-shaped sports cards where the two
  // sides resolve to seeded team brands. home = side_a, away = side_b; either
  // can be null when that side's label matches no team (goal-range markets,
  // unseeded clubs). null/absent → the card uses its default side colors.
  sportsTeams?: {
    home: DiscoverySportsTeam | null;
    away: DiscoverySportsTeam | null;
  } | null;
  // sports is semantic game metadata for frontend gates/search/filtering. It is
  // separate from sportsTeams, which is visual team-brand display state.
  sports?: DiscoverySportsGame | null;
  isEventChildCard?: boolean;
  volume: {
    value: string;
    label: string | null;
  };
  activity: {
    recentTradeCount: number;
    recentTradeVolume: {
      value: string;
      label: string | null;
    };
  };
  viewerPosition: {
    side: string;
    shares: number;
    averageCost: number;
    pnlLabel?: string;
    outcomeKey: string;
    contractSide: "yes" | "no";
  } | null;
  movement: {
    outcomeKey: string;
    window: "24h";
    fromProbability: string;
    toProbability: string;
    deltaPercent: number;
    absDeltaPercent: number;
    tradeCount: number;
    volume: {
      value: string;
      label: string | null;
    };
  } | null;
  outcomes: Array<{
    outcomeKey: string;
    label: string;
    probability: string;
    displayProbability: string;
    role: DiscoveryOutcomeRole | null;
  }>;
  preview: {
    marketType: "binary" | "multi_outcome";
    topOutcomes: Array<{
      outcomeKey: string;
      label: string;
      probability: string;
      displayProbability: string;
      role: DiscoveryOutcomeRole | null;
    }>;
  };
  signals: DiscoverySignal[];
};

export type DiscoveryFeedResponse = {
  feed: DiscoveryFeedName;
  category: string | null;
  generatedAt: string;
  featured: {
    marketKey: string;
    reasonCode: "most_traded";
    reasonLabel: string;
    metric: {
      kind: "trade_volume";
      window: "all_time";
      value: string;
      label: string | null;
    };
  } | null;
  heroItems?: DiscoveryFeedItem[];
  items: DiscoveryFeedItem[];
  pagination?: {
    limit: number;
    nextCursor: string | null;
    hasMore: boolean;
    totalAvailable: number;
  };
};
