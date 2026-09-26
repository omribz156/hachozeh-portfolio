import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Pool } from "pg";

import type { RequestActor } from "../../auth/actor-resolver";
import {
  createMarketDraft,
  parseCreateMarketDraftRequest,
  type CreateMarketDraftRequest,
  type CreateMarketDraftResponse,
  type EventResolutionPolicy,
  type MarketEnvironment,
  type MarketContractV1Snapshot
} from "./create-market-draft-service";
import { resolveMarketCreationLiquidityB } from "./market-creation-liquidity";
import { slugifyMarketIdPart } from "./market-slug";

type SeerMarketDraftOutcome = {
  outcomeId: string | null;
  label: string;
  shortLabel: string | null;
  description: string | null;
  colorKey: string | null;
};

type SeerDraftOracleSourcePolicy = {
  preferredSourceIds?: string[];
  fallbackSourceIds?: string[];
  contextSourceIds?: string[];
  closeConditionSourceIds?: string[];
  resolutionSourceIds?: string[];
  requiresHumanReviewOnSourceConflict?: boolean;
  requiresHumanReviewOnWeakAuthority?: boolean;
  notes?: string[];
};

export type SeerMarketWatchPlanDraft = {
  id: string;
  target: "event" | "market";
  checkerKind: "show_official_keywords";
  enabled: boolean;
  timezone: string;
  sourceUrls: string[];
  entities: string[];
  keywords: string[];
  runAt: string[];
  intervalMinutes: number | null;
  nextRunAt: string | null;
  proximityChars: number | null;
  note: string | null;
};

export type SeerMarketCreationDraft = {
  objectType: "market_creation_draft";
  creationDraftId: string;
  reviewItemId: string;
  candidateMarketId: string;
  familyKey?: string;
  eventId?: string;
  eventSlug?: string;
  eventTitle?: string;
  eventDescription?: string | null;
  eventIcon?: string | null;
  eventResolutionPolicy?: EventResolutionPolicy | null;
  eventChildLabel?: string | null;
  eventShowParentInDiscovery?: boolean | null;
  eventShowChildrenInDiscovery?: boolean | null;
  intakeLane?: "planned-event" | "shock-discovery";
  recurringTemplateId?: string;
  category: string;
  categoryKey: string | null;
  title: string;
  description: string | null;
  openAt: string;
  closeAt: string;
  resolutionSource: string;
  resolutionRules: string;
  contract?: MarketContractV1Snapshot | null;
  oracleSourcePolicy: SeerDraftOracleSourcePolicy | null;
  liquidityB: string;
  seedAmount?: string;
  closeOnEventCompletion: boolean;
  eventCompletionCloseRequiresHumanApproval: boolean;
  outcomes: SeerMarketDraftOutcome[];
  idempotencyKey: string;
  whyNow: string;
  createdAt: string;
  sourceRolePlan?: {
    wake: string[];
    ground: string[];
    resolve: string[];
    integrity?: string[];
    notes?: string[];
  };
  topSourceRefs?: string[];
  topSourceIds?: string[];
  marketEnvironment?: MarketEnvironment;
  notes?: string[];
  watchPlan?: SeerMarketWatchPlanDraft;
};

export type SeerMarketCreationDraftSnapshot = {
  objectType: "market_creation_draft_snapshot";
  snapshotId: string;
  generatedAt: string;
  itemCount: number;
  items: SeerMarketCreationDraft[];
};

export type SeerDraftMaterializationRecord = {
  objectType: "seer_market_creation_materialization";
  materializationId: string;
  creationDraftId: string;
  candidateMarketId: string;
  reviewItemId: string;
  marketId: string;
  eventId: string;
  status: "draft";
  createdAt: string;
  openAt: string;
  closeAt: string;
  auditEventId: string;
};

const DEFAULT_SEER_DRAFT_SNAPSHOT_PATH = resolve(
  __dirname,
  "../../../../seer/state/market-creation-drafts-latest.json"
);
const SEER_DRAFT_SNAPSHOT_PATH_ENV = "SEER_MARKET_CREATION_DRAFT_SNAPSHOT_PATH";

function resolveDefaultSeerDraftSnapshotPath(): string {
  const override = process.env[SEER_DRAFT_SNAPSHOT_PATH_ENV]?.trim();

  return override || DEFAULT_SEER_DRAFT_SNAPSHOT_PATH;
}

export function buildSeerMarketId(candidateMarketId: string, version = 1): string {
  const baseId = `disc-${slugifyMarketIdPart(candidateMarketId, "market")}`;
  return version <= 1 ? baseId : `${baseId}-v${version}`;
}

export async function resolveNextSeerMarketId(
  dbPool: Pool,
  candidateMarketId: string
): Promise<string> {
  const baseId = buildSeerMarketId(candidateMarketId);
  const result = await dbPool.query<{ id: string; status: "draft" | "open" | "closed" | "resolved" | "voided" }>(
    `
      select id, status
      from markets
      where id = $1 or id like $2
      order by id asc
    `,
    [baseId, `${baseId}-v%`]
  );

  if (result.rowCount === 0) {
    return baseId;
  }

  const openOrDraft = result.rows.find((row) => row.status === "draft" || row.status === "open");

  if (openOrDraft) {
    return openOrDraft.id;
  }

  let maxVersion = 1;

  for (const row of result.rows) {
    if (row.id === baseId) {
      maxVersion = Math.max(maxVersion, 1);
      continue;
    }

    const match = row.id.match(/-v(\d+)$/);

    if (match?.[1]) {
      maxVersion = Math.max(maxVersion, Number.parseInt(match[1], 10));
    }
  }

  return buildSeerMarketId(candidateMarketId, maxVersion + 1);
}

function readOptionalString(value: unknown): string | null {
  if (value == null) {
    return null;
  }

  if (typeof value !== "string") {
    throw new Error("Expected string or null.");
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readString(value: unknown, label: string): string {
  const trimmed = readOptionalString(value);

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function readBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be boolean.`);
  }

  return value;
}

function readOptionalBoolean(value: unknown, label: string): boolean | null {
  if (value == null) {
    return null;
  }

  return readBoolean(value, label);
}

function normalizeOutcomes(value: unknown): SeerMarketDraftOutcome[] {
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("draft outcomes must include at least two entries.");
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`draft outcomes[${index}] must be an object.`);
    }

    const candidate = entry as Record<string, unknown>;

    return {
      outcomeId: readOptionalString(candidate.outcomeId),
      label: readString(candidate.label, `draft outcomes[${index}].label`),
      shortLabel: readOptionalString(candidate.shortLabel),
      description: readOptionalString(candidate.description),
      colorKey: readOptionalString(candidate.colorKey)
    };
  });
}

function normalizeContract(value: unknown): MarketContractV1Snapshot | null {
  if (value == null) {
    return null;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("draft contract must be an object.");
  }

  const candidate = value as Record<string, unknown>;

  if (candidate.objectType !== "market_contract_v1") {
    throw new Error("draft contract.objectType must be market_contract_v1.");
  }

  return candidate as MarketContractV1Snapshot;
}

function normalizeStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }
  return value.map((entry, index) => readString(entry, `${label}[${index}]`));
}

function normalizeWatchPlan(value: unknown): SeerMarketWatchPlanDraft | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("watchPlan must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  const target = candidate.target ?? "event";
  if (target !== "event" && target !== "market") {
    throw new Error("watchPlan.target must be event or market.");
  }
  const checkerKind = candidate.checkerKind ?? "show_official_keywords";
  if (checkerKind !== "show_official_keywords") {
    throw new Error("watchPlan.checkerKind is unsupported.");
  }
  const intervalMinutes = candidate.intervalMinutes == null ? null : Number(candidate.intervalMinutes);
  if (intervalMinutes !== null && (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0)) {
    throw new Error("watchPlan.intervalMinutes must be positive.");
  }
  const proximityChars = candidate.proximityChars == null ? null : Number(candidate.proximityChars);
  if (proximityChars !== null && (!Number.isFinite(proximityChars) || proximityChars <= 0)) {
    throw new Error("watchPlan.proximityChars must be positive.");
  }

  return {
    id: readString(candidate.id, "watchPlan.id"),
    target,
    checkerKind,
    enabled: candidate.enabled == null ? true : readBoolean(candidate.enabled, "watchPlan.enabled"),
    timezone: readOptionalString(candidate.timezone) ?? "Asia/Jerusalem",
    sourceUrls: normalizeStringArray(candidate.sourceUrls, "watchPlan.sourceUrls"),
    entities: normalizeStringArray(candidate.entities, "watchPlan.entities"),
    keywords: normalizeStringArray(candidate.keywords, "watchPlan.keywords"),
    runAt: candidate.runAt == null ? [] : normalizeStringArray(candidate.runAt, "watchPlan.runAt"),
    intervalMinutes,
    nextRunAt: readOptionalString(candidate.nextRunAt),
    proximityChars,
    note: readOptionalString(candidate.note)
  };
}

function normalizeEventResolutionPolicy(value: unknown): EventResolutionPolicy | null {
  const policy = readOptionalString(value);

  if (policy === null) {
    return null;
  }

  if (policy !== "independent_children" && policy !== "exclusive_first_hit") {
    throw new Error("eventResolutionPolicy must be independent_children or exclusive_first_hit.");
  }

  return policy;
}

function normalizeDraft(value: unknown): SeerMarketCreationDraft {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("draft must be an object.");
  }

  const candidate = value as Record<string, unknown>;

  return {
    objectType: "market_creation_draft",
    creationDraftId: readString(candidate.creationDraftId, "creationDraftId"),
    reviewItemId: readString(candidate.reviewItemId, "reviewItemId"),
    candidateMarketId: readString(candidate.candidateMarketId, "candidateMarketId"),
    familyKey: readOptionalString(candidate.familyKey) ?? undefined,
    eventId: readOptionalString(candidate.eventId) ?? undefined,
    eventSlug: readOptionalString(candidate.eventSlug) ?? undefined,
    eventTitle: readOptionalString(candidate.eventTitle) ?? undefined,
    eventDescription: readOptionalString(candidate.eventDescription),
    eventIcon: readOptionalString(candidate.eventIcon),
    eventResolutionPolicy: normalizeEventResolutionPolicy(candidate.eventResolutionPolicy),
    eventChildLabel: readOptionalString(candidate.eventChildLabel),
    eventShowParentInDiscovery: readOptionalBoolean(
      candidate.eventShowParentInDiscovery,
      "eventShowParentInDiscovery"
    ),
    eventShowChildrenInDiscovery: readOptionalBoolean(
      candidate.eventShowChildrenInDiscovery,
      "eventShowChildrenInDiscovery"
    ),
    intakeLane:
      candidate.intakeLane === "planned-event" || candidate.intakeLane === "shock-discovery"
        ? candidate.intakeLane
        : undefined,
    recurringTemplateId: readOptionalString(candidate.recurringTemplateId) ?? undefined,
    category: readString(candidate.category, "category"),
    categoryKey: readOptionalString(candidate.categoryKey),
    title: readString(candidate.title, "title"),
    description: readOptionalString(candidate.description),
    openAt: readString(candidate.openAt, "openAt"),
    closeAt: readString(candidate.closeAt, "closeAt"),
    resolutionSource: readString(candidate.resolutionSource, "resolutionSource"),
    resolutionRules: readString(candidate.resolutionRules, "resolutionRules"),
    contract: normalizeContract(candidate.contract),
    oracleSourcePolicy:
      candidate.oracleSourcePolicy && typeof candidate.oracleSourcePolicy === "object" && !Array.isArray(candidate.oracleSourcePolicy)
        ? (candidate.oracleSourcePolicy as SeerDraftOracleSourcePolicy)
        : null,
    liquidityB: readString(candidate.liquidityB, "liquidityB"),
    seedAmount: readOptionalString(candidate.seedAmount) ?? undefined,
    closeOnEventCompletion: readBoolean(candidate.closeOnEventCompletion, "closeOnEventCompletion"),
    eventCompletionCloseRequiresHumanApproval: readBoolean(
      candidate.eventCompletionCloseRequiresHumanApproval,
      "eventCompletionCloseRequiresHumanApproval"
    ),
    outcomes: normalizeOutcomes(candidate.outcomes),
    idempotencyKey: readString(candidate.idempotencyKey, "idempotencyKey"),
    whyNow: readString(candidate.whyNow, "whyNow"),
    createdAt: readString(candidate.createdAt, "createdAt"),
    sourceRolePlan:
      candidate.sourceRolePlan && typeof candidate.sourceRolePlan === "object" && !Array.isArray(candidate.sourceRolePlan)
        ? (candidate.sourceRolePlan as SeerMarketCreationDraft["sourceRolePlan"])
        : undefined,
    topSourceRefs: Array.isArray(candidate.topSourceRefs)
      ? candidate.topSourceRefs.map((entry) => readString(entry, "topSourceRefs[]"))
      : undefined,
    topSourceIds: Array.isArray(candidate.topSourceIds)
      ? candidate.topSourceIds.map((entry) => readString(entry, "topSourceIds[]"))
      : undefined,
    marketEnvironment: normalizeMarketEnvironment(candidate.marketEnvironment),
    notes: Array.isArray(candidate.notes) ? candidate.notes.map((entry) => readString(entry, "notes[]")) : undefined,
    watchPlan: normalizeWatchPlan(candidate.watchPlan)
  };
}

function normalizeMarketEnvironment(value: unknown): MarketEnvironment | undefined {
  const environment = readOptionalString(value);

  if (environment === null) {
    return undefined;
  }

  if (environment !== "prod" && environment !== "test") {
    throw new Error("marketEnvironment must be prod or test.");
  }

  return environment;
}

export function parseSeerMarketCreationDraftSnapshot(
  value: unknown
): SeerMarketCreationDraftSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Seer draft snapshot must be an object.");
  }

  const candidate = value as Record<string, unknown>;
  const itemsRaw = candidate.items;

  if (!Array.isArray(itemsRaw)) {
    throw new Error("Seer draft snapshot items must be an array.");
  }

  return {
    objectType: "market_creation_draft_snapshot",
    snapshotId: readString(candidate.snapshotId, "snapshotId"),
    generatedAt: readString(candidate.generatedAt, "generatedAt"),
    itemCount: typeof candidate.itemCount === "number" ? candidate.itemCount : itemsRaw.length,
    items: itemsRaw.map((item) => normalizeDraft(item))
  };
}

export async function readSeerMarketCreationDraftSnapshot(
  snapshotPath = resolveDefaultSeerDraftSnapshotPath()
): Promise<SeerMarketCreationDraftSnapshot | null> {
  try {
    const contents = await readFile(snapshotPath, "utf8");
    return parseSeerMarketCreationDraftSnapshot(JSON.parse(contents));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;

    if (nodeError.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function buildCreateMarketDraftRequestFromSeerDraft(
  draft: SeerMarketCreationDraft,
  marketId = buildSeerMarketId(draft.candidateMarketId),
  options: {
    marketEnvironment?: MarketEnvironment;
    showGraph?: boolean;
    showParentInDiscovery?: boolean;
    showChildrenInDiscovery?: boolean;
  } = {}
): CreateMarketDraftRequest {
  return parseCreateMarketDraftRequest({
    marketId,
    familyKey: draft.familyKey ?? draft.recurringTemplateId ?? null,
    eventId: draft.eventId ?? null,
    eventSlug: draft.eventSlug ?? null,
    eventTitle: draft.eventTitle ?? null,
    eventDescription: draft.eventDescription ?? null,
    eventIcon: draft.eventIcon ?? null,
    eventResolutionPolicy: draft.eventResolutionPolicy ?? null,
    eventChildLabel: draft.eventChildLabel ?? null,
    eventShowGraph: options.showGraph ?? false,
    eventShowParentInDiscovery:
      options.showParentInDiscovery ?? draft.eventShowParentInDiscovery ?? null,
    eventShowChildrenInDiscovery:
      options.showChildrenInDiscovery ?? draft.eventShowChildrenInDiscovery ?? null,
    marketEnvironment: options.marketEnvironment ?? draft.marketEnvironment ?? "prod",
    title: draft.title,
    description: draft.description,
    categoryKey: draft.categoryKey,
    openAt: draft.openAt,
    closeAt: draft.closeAt,
    resolutionSource: draft.resolutionSource,
    resolutionRules: draft.resolutionRules,
    marketContract: draft.contract ?? null,
    oracleSourcePolicy: draft.oracleSourcePolicy,
    liquidityB: draft.liquidityB,
    closeOnEventCompletion: draft.closeOnEventCompletion,
    eventCompletionCloseRequiresHumanApproval: draft.eventCompletionCloseRequiresHumanApproval,
    outcomes: draft.outcomes,
    idempotencyKey: `${draft.idempotencyKey}:${marketId}`
  });
}

export function resolveSeerDraftLiquidityB(draft: Pick<
  SeerMarketCreationDraft,
  "category" | "categoryKey" | "familyKey" | "recurringTemplateId" | "liquidityB" | "outcomes"
>): string {
  return resolveMarketCreationLiquidityB({
    categoryKey: draft.categoryKey ?? draft.category,
    familyKey: draft.familyKey ?? draft.recurringTemplateId ?? null,
    liquidityB: draft.liquidityB,
    outcomeCount: draft.outcomes.length
  });
}

export async function materializeSeerMarketCreationDraft(
  dbPool: Pool,
  draft: SeerMarketCreationDraft,
  actor: RequestActor,
  options: {
    marketEnvironment?: MarketEnvironment;
    showGraph?: boolean;
    showParentInDiscovery?: boolean;
    showChildrenInDiscovery?: boolean;
  } = {}
): Promise<SeerDraftMaterializationRecord> {
  const marketId = await resolveNextSeerMarketId(dbPool, draft.candidateMarketId);
  const request = buildCreateMarketDraftRequestFromSeerDraft(draft, marketId, options);
  const response: CreateMarketDraftResponse = await createMarketDraft(dbPool, request, actor);

  return {
    objectType: "seer_market_creation_materialization",
    materializationId: `dmat_${randomUUID()}`,
    creationDraftId: draft.creationDraftId,
    candidateMarketId: draft.candidateMarketId,
    reviewItemId: draft.reviewItemId,
    marketId: response.marketId,
    eventId: response.eventId,
    status: response.status,
    createdAt: response.createdAt,
    openAt: response.openAt,
    closeAt: response.closeAt,
    auditEventId: response.auditEventId
  };
}

export async function stampMaterializedMarketEnvironment(
  dbPool: Pool,
  marketId: string,
  marketEnvironment: MarketEnvironment
): Promise<void> {
  await dbPool.query(
    `
      update markets
      set
        market_environment = $2,
        market_contract = jsonb_set(
          coalesce(market_contract, '{}'::jsonb),
          '{operational}',
          coalesce(market_contract #> '{operational}', '{}'::jsonb) || jsonb_build_object('environment', $2::text),
          true
        ),
        updated_at = now()
      where id = $1
    `,
    [marketId, marketEnvironment]
  );
}
