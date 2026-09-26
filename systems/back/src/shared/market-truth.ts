import {
  localizeResolutionSourceLabel,
  publicizeResolutionSourceText,
  toPublicResolutionSourceUrl
} from "./public-source";

type MarketContractV1 = Record<string, unknown> & {
  objectType: "market_contract_v1";
};

export type MarketTruthRow = {
  market_status: string;
  persisted_status?: string | null;
  open_at: Date;
  close_at: Date;
  published_at?: Date | null;
  updated_at: Date;
  settlement_status?: string | null;
  market_resolved_at?: Date | null;
  resolution_resolved_at?: Date | null;
  market_contract?: unknown;
};

export function readMarketContractV1(value: unknown): MarketContractV1 | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const contract = value as Record<string, unknown>;

  if (contract.objectType !== "market_contract_v1") {
    return undefined;
  }

  return contract as MarketContractV1;
}

function compactContractField(contract: MarketContractV1, key: string) {
  return key in contract ? contract[key] : null;
}

function readPlainObjectField(value: Record<string, unknown>, key: string): unknown {
  const field = value[key];

  if (!field || typeof field !== "object" || Array.isArray(field)) {
    return undefined;
  }

  return field;
}

function buildPublicResolutionSource(contract: MarketContractV1): unknown {
  const source = compactContractField(contract, "resolutionSource");

  if (!source || typeof source !== "object" || Array.isArray(source)) {
    return source;
  }

  const candidate = source as Record<string, unknown>;
  const url = typeof candidate.url === "string" ? toPublicResolutionSourceUrl(candidate.url) : candidate.url;
  const sourceIds = Array.isArray(candidate.sourceIds)
    ? candidate.sourceIds.filter((entry): entry is string => typeof entry === "string")
    : [];
  const label =
    typeof candidate.label === "string"
      ? localizeResolutionSourceLabel(candidate.label, sourceIds)
      : candidate.label;

  return {
    ...candidate,
    label,
    url
  };
}

function publicizeDelayPolicy(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();

  if (
    trimmed ===
    "If the resolution source is delayed or ambiguous, keep the market pending until a human reviewer verifies the official result."
  ) {
    return "אם המקור הרשמי מתעכב או לא ברור, השוק נשאר בהמתנה עד שמפעיל מאמת את התוצאה הרשמית.";
  }

  return trimmed;
}

function publicizeSourceTextField(value: unknown): unknown {
  if (typeof value === "string") {
    return publicizeResolutionSourceText(value);
  }

  if (Array.isArray(value)) {
    return value.map(publicizeSourceTextField);
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        publicizeSourceTextField(entry)
      ])
    );
  }

  return value;
}

export function buildPublicMarketContract(value: unknown) {
  const contract = readMarketContractV1(value);

  if (!contract) {
    return undefined;
  }

  return {
    objectType: contract.objectType,
    version: compactContractField(contract, "version"),
    measurement: compactContractField(contract, "measurement"),
    measurementKind: compactContractField(contract, "measurementKind"),
    resultShape: compactContractField(contract, "resultShape"),
    displayHints: compactContractField(contract, "displayHints"),
    resolutionSource: buildPublicResolutionSource(contract),
    resolutionRule: publicizeSourceTextField(compactContractField(contract, "resolutionRule")),
    timeline: compactContractField(contract, "timeline"),
    delayPolicy: publicizeDelayPolicy(compactContractField(contract, "delayPolicy")),
    dataRevisionPolicy: compactContractField(contract, "dataRevisionPolicy"),
    ambiguityPolicy: compactContractField(contract, "ambiguityPolicy"),
    reviewBlockers: compactContractField(contract, "reviewBlockers"),
    sourceRolePlan: publicizeSourceTextField(compactContractField(contract, "sourceRolePlan")),
    payoutPolicy: compactContractField(contract, "payoutPolicy"),
    referenceQuarantine: compactContractField(contract, "referenceQuarantine"),
    oracleCapability: compactContractField(contract, "oracleCapability"),
    image: compactContractField(contract, "image"),
    outcomeMap: compactContractField(contract, "outcomeMap")
  };
}

// Returns the public-safe contract image plus the assetId Seer stamped at
// curation time. Presenters use the assetId to hydrate optional read-time
// data from the registry (e.g. editorial `photoPath`) without baking display
// state into the contract — updating the registry instantly reflects on
// every existing market with no contract re-stamp.
export function readContractMarketImage(value: unknown): {
  src: string;
  alt: string;
  assetId?: string;
  theme?: unknown;
} | null {
  const contract = readMarketContractV1(value);
  const image = contract?.image;

  if (!image || typeof image !== "object" || Array.isArray(image)) {
    return null;
  }

  const candidate = image as {
    src?: unknown;
    alt?: unknown;
    assetId?: unknown;
    rights?: {
      publicUse?: unknown;
      status?: unknown;
    };
  };

  if (typeof candidate.src !== "string" || candidate.src.trim().length === 0) {
    return null;
  }

  if (
    !candidate.rights ||
    candidate.rights.publicUse !== "allowed" ||
    !["hachozeh-owned", "licensed", "approved-third-party"].includes(
      typeof candidate.rights.status === "string" ? candidate.rights.status : ""
    )
  ) {
    return null;
  }

  return {
    src: candidate.src.trim(),
    alt: typeof candidate.alt === "string" && candidate.alt.trim().length > 0 ? candidate.alt.trim() : "תמונת שוק",
    ...(typeof candidate.assetId === "string" && candidate.assetId.trim().length > 0
      ? { assetId: candidate.assetId.trim() }
      : {}),
    ...(readPlainObjectField(image as Record<string, unknown>, "theme")
      ? { theme: readPlainObjectField(image as Record<string, unknown>, "theme") }
      : {})
  };
}

export function readContractExpectedResolutionAt(value: unknown): string | null {
  const contract = readMarketContractV1(value);
  const timeline = contract?.timeline;

  if (!timeline || typeof timeline !== "object" || Array.isArray(timeline)) {
    return null;
  }

  const expectedResolutionAt = (timeline as { expectedResolutionAt?: unknown })
    .expectedResolutionAt;

  if (typeof expectedResolutionAt !== "string" || expectedResolutionAt.trim().length === 0) {
    return null;
  }

  const parsed = new Date(expectedResolutionAt);

  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function readContractPayoutPolicy(value: unknown): unknown {
  const contract = readMarketContractV1(value);

  if (contract && "payoutPolicy" in contract && contract.payoutPolicy != null) {
    return contract.payoutPolicy;
  }

  return {
    kind: "after_official_resolution_settlement",
    label: "התשלום מתבצע לאחר הכרעה רשמית וסיום הסליקה.",
    description:
      "סגירת המסחר אינה זמן התשלום. התשלום תלוי בהכרעה רשמית ובהשלמת settlement."
  };
}

export function buildMarketLifecycle(row: MarketTruthRow) {
  const resolvedAt = row.market_resolved_at ?? row.resolution_resolved_at ?? null;

  return {
    openAt: row.open_at.toISOString(),
    closeAt: row.close_at.toISOString(),
    expectedResolutionAt: readContractExpectedResolutionAt(row.market_contract),
    publishedAt: row.published_at?.toISOString() ?? null,
    updatedAt: row.updated_at.toISOString(),
    resolvedAt: resolvedAt?.toISOString() ?? null,
    persistedStatus: row.persisted_status ?? row.market_status,
    effectiveStatus: row.market_status,
    settlementStatus: row.settlement_status ?? null,
    payoutPolicy: readContractPayoutPolicy(row.market_contract)
  };
}
