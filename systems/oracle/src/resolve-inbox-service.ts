import type { Queryable } from "../../back/src/platform-surface/oracle";

import { normalizeOracleLimit } from "./oracle-options";
import { readOracleReviewQueue } from "./review-queue-service";
import { normalizeMarketContract } from "./source-adapter-contracts";

type MissingResolutionCaseRow = {
  market_id: string;
  market_title: string;
  market_status: "closed";
  close_at: Date | null;
  closed_at: Date | null;
  resolution_source: string | null;
  resolution_rules: string | null;
  market_contract: unknown;
};

type OracleResolveInboxMissingCaseItem = {
  itemType: "missing_case";
  marketId: string;
  marketTitle: string;
  marketStatus: "closed";
  closeAt: string | null;
  closedAt: string | null;
  ageHours: number | null;
  resolutionSource: string | null;
  resolutionRules: string | null;
  fallbackResolutionAllowed: boolean;
  fallbackEvidenceStandard: string | null;
  primarySourceUrl: string | null;
  lifecycleFit?: string | null;
  expectedResolutionAt?: string | null;
  nextAction: "create_resolution_case";
  suggestedCommand: string;
};

type OracleResolveInboxRecommendedCaseItem = {
  itemType: "recommended_case";
  marketId: string;
  marketTitle: string;
  oracleCaseId: string;
  caseStatus: "recommended";
  ambiguityLevel: "low" | "medium" | "high" | null;
  winningOutcomeId: string | null;
  winningOutcomeLabel: string | null;
  evidencePacketId: string | null;
  evidenceSummary: string | null;
  sourceCount: number | null;
  nextAction: "approve_reject_or_request_more_evidence";
  suggestedApproveCommand: string;
  suggestedRejectCommand: string;
  suggestedMoreEvidenceCommand: string;
};

type OracleResolveInboxReviewNeededCaseItem = {
  itemType: "review_needed_case";
  marketId: string;
  marketTitle: string;
  oracleCaseId: string;
  caseStatus: "review_needed";
  ambiguityLevel: "low" | "medium" | "high" | null;
  summary: string | null;
  evidencePacketId: string | null;
  evidenceSummary: string | null;
  sourceCount: number | null;
  nextAction: "inspect_resolve_or_void";
  suggestedInspectCommand: string;
  suggestedVoidCommand: string;
};

type TerminalReviewRow = {
  oracle_case_id: string;
};

export type OracleResolveInboxResult = {
  objectType: "oracle_resolve_inbox";
  generatedAt: string;
  marketId: string | null;
  missingCaseCount: number;
  recommendedCaseCount: number;
  reviewNeededCaseCount: number;
  missingCases: OracleResolveInboxMissingCaseItem[];
  recommendedCases: OracleResolveInboxRecommendedCaseItem[];
  reviewNeededCases: OracleResolveInboxReviewNeededCaseItem[];
};

export type ReadOracleResolveInboxOptions = {
  marketId?: string;
  limit?: number;
};

function buildAgeHours(closedAt: Date | null, now: Date): number | null {
  if (!closedAt) {
    return null;
  }

  return Number(((now.getTime() - closedAt.getTime()) / 3_600_000).toFixed(2));
}

function quoteFlag(value: string): string {
  return `"${value.replace(/["\\$`]/g, "\\$&")}"`;
}

function readPrimarySourceUrl(item: MissingResolutionCaseRow): string | null {
  const contract = normalizeMarketContract(item.market_contract);
  return (
    contract?.trustDisplayUrl?.trim() ||
    contract?.resolutionSource?.url?.trim() ||
    item.resolution_source?.trim() ||
    null
  );
}

function readLifecycleFit(item: MissingResolutionCaseRow): string | null {
  const lifecycleFit = normalizeMarketContract(item.market_contract)?.lifecycleFit;
  return typeof lifecycleFit === "string" && lifecycleFit.trim().length > 0
    ? lifecycleFit.trim()
    : null;
}

function readExpectedResolutionAt(item: MissingResolutionCaseRow): string | null {
  const expectedResolutionAt = normalizeMarketContract(item.market_contract)?.timeline?.expectedResolutionAt;
  return typeof expectedResolutionAt === "string" && expectedResolutionAt.trim().length > 0
    ? expectedResolutionAt.trim()
    : null;
}

function readFallbackEvidenceStandard(item: MissingResolutionCaseRow): string | null {
  const standard = normalizeMarketContract(item.market_contract)?.fallbackEvidenceStandard;
  return typeof standard === "string" && standard.trim().length > 0 ? standard.trim() : null;
}

function allowsFallbackResolution(item: MissingResolutionCaseRow): boolean {
  return normalizeMarketContract(item.market_contract)?.allowFallbackResolution === true;
}

function buildInspectCommand(item: MissingResolutionCaseRow): string {
  const command = [
    "npm --prefix systems/back run oracle -- inspect-resolution",
    `--market ${item.market_id}`,
    "--source-url <official-source-url>",
    '--source-label "<official source label>"',
    "--source-type official",
    '--claim-summary "<final result and winning outcome mapping>"',
    "--winning-outcome-key <winning-outcome-key>",
    "--requires-human-review true",
    "--json"
  ];
  const primarySourceUrl = readPrimarySourceUrl(item);
  const fallbackEvidenceStandard = readFallbackEvidenceStandard(item);

  if (allowsFallbackResolution(item) && primarySourceUrl && fallbackEvidenceStandard) {
    command.splice(
      2,
      4,
      "--source-url <fallback-source-url-1>|<fallback-source-url-2>",
      '--source-label "<fallback source label 1>|<fallback source label 2>"',
      "--source-type fallback_report",
      "--independent-group-id <group-1>|<group-2>",
      '--claim-summary "<final result and winning outcome mapping>"'
    );
    command.splice(
      command.length - 1,
      0,
      "--fallback-resolution true",
      `--fallback-evidence-standard ${fallbackEvidenceStandard}`,
      `--primary-source-url ${quoteFlag(primarySourceUrl)}`,
      '--primary-failure-reason "<official source fetch unavailable>"'
    );
  }

  return command.join(" ");
}

function buildIdempotencyKey(prefix: string, oracleCaseId: string): string {
  return `${prefix}:${oracleCaseId}`;
}

async function readMissingResolutionCases(
  db: Queryable,
  options: {
    marketId?: string;
    limit: number;
  }
): Promise<MissingResolutionCaseRow[]> {
  const values: unknown[] = [];
  const where = [
    "m.status = 'closed'",
    "m.resolved_at is null",
    `not exists (
      select 1
      from oracle_cases oc
      where oc.market_id = m.id
        and oc.case_type = 'resolution_check'
    )`
  ];

  if (options.marketId) {
    values.push(options.marketId);
    where.push(`m.id = $${values.length}`);
  }

  values.push(options.limit);

  const result = await db.query<MissingResolutionCaseRow>(
    `
      select
        m.id as market_id,
        m.title as market_title,
        m.status as market_status,
        m.close_at,
        m.closed_at,
        m.resolution_source,
        m.resolution_rules,
        m.market_contract
      from (
        select
          m.*,
          nullif(m.market_contract #>> '{timeline,expectedResolutionAt}', '') as expected_resolution_at
        from markets m
      ) m
      where ${where.join(" and ")}
      order by m.closed_at nulls last, m.close_at nulls last
      limit $${values.length}
    `,
    values
  );

  return result.rows;
}

async function readTerminalReviewCaseIds(
  db: Queryable,
  oracleCaseIds: string[]
): Promise<Set<string>> {
  if (oracleCaseIds.length === 0) {
    return new Set();
  }

  const result = await db.query<TerminalReviewRow>(
    `
      select distinct oracle_case_id
      from oracle_case_reviews
      where oracle_case_id = any($1::text[])
        and result_status = 'completed'
        and review_action in (
          'approve_resolution',
          'reject_case',
          'request_more_evidence'
        )
    `,
    [oracleCaseIds]
  );

  return new Set(result.rows.map((row) => row.oracle_case_id));
}

async function readCurrentlyClosedUnresolvedMarketIds(
  db: Queryable,
  marketIds: string[]
): Promise<Set<string>> {
  const uniqueMarketIds = [...new Set(marketIds)];

  if (uniqueMarketIds.length === 0) {
    return new Set();
  }

  const result = await db.query<{ id: string }>(
    `
      select id
      from markets
      where id = any($1::text[])
        and status = 'closed'
        and resolved_at is null
    `,
    [uniqueMarketIds]
  );

  return new Set(result.rows.map((row) => row.id));
}

export async function readOracleResolveInbox(
  db: Queryable,
  options?: ReadOracleResolveInboxOptions
): Promise<OracleResolveInboxResult> {
  const limit = normalizeOracleLimit(options?.limit);
  const now = new Date();
  const missingRows = await readMissingResolutionCases(db, {
    marketId: options?.marketId,
    limit
  });
  const recommendedQueue = await readOracleReviewQueue(db, {
    caseStatus: "recommended",
    caseType: "resolution_check",
    marketId: options?.marketId,
    limit
  });
  const reviewNeededQueue = await readOracleReviewQueue(db, {
    caseStatus: "review_needed",
    caseType: "resolution_check",
    marketId: options?.marketId,
    limit
  });
  const terminalReviewCaseIds = await readTerminalReviewCaseIds(
    db,
    [
      ...recommendedQueue.items.map((item) => item.oracleCaseId),
      ...reviewNeededQueue.items.map((item) => item.oracleCaseId)
    ]
  );
  const currentlyClosedUnresolvedMarketIds = await readCurrentlyClosedUnresolvedMarketIds(
    db,
    [
      ...recommendedQueue.items.map((item) => item.marketId),
      ...reviewNeededQueue.items.map((item) => item.marketId)
    ]
  );
  const actionableRecommendedItems = recommendedQueue.items.filter(
    (item) =>
      currentlyClosedUnresolvedMarketIds.has(item.marketId) &&
      !terminalReviewCaseIds.has(item.oracleCaseId)
  );
  const actionableReviewNeededItems = reviewNeededQueue.items.filter(
    (item) =>
      currentlyClosedUnresolvedMarketIds.has(item.marketId) &&
      !terminalReviewCaseIds.has(item.oracleCaseId)
  );

  const missingCases = missingRows.map((row): OracleResolveInboxMissingCaseItem => ({
    itemType: "missing_case",
    marketId: row.market_id,
    marketTitle: row.market_title,
    marketStatus: row.market_status,
    closeAt: row.close_at?.toISOString() ?? null,
    closedAt: row.closed_at?.toISOString() ?? null,
    ageHours: buildAgeHours(row.closed_at, now),
    resolutionSource: row.resolution_source,
    resolutionRules: row.resolution_rules,
    fallbackResolutionAllowed: allowsFallbackResolution(row),
    fallbackEvidenceStandard: readFallbackEvidenceStandard(row),
    primarySourceUrl: readPrimarySourceUrl(row),
    lifecycleFit: readLifecycleFit(row),
    expectedResolutionAt: readExpectedResolutionAt(row),
    nextAction: "create_resolution_case",
    suggestedCommand: buildInspectCommand(row)
  }));

  const recommendedCases = actionableRecommendedItems.map(
    (item): OracleResolveInboxRecommendedCaseItem => ({
      itemType: "recommended_case",
      marketId: item.marketId,
      marketTitle: item.marketTitle,
      oracleCaseId: item.oracleCaseId,
      caseStatus: "recommended",
      ambiguityLevel: item.ambiguityLevel,
      winningOutcomeId: item.winningOutcomeId,
      winningOutcomeLabel: item.winningOutcomeLabel,
      evidencePacketId: item.evidencePacket?.evidencePacketId ?? null,
      evidenceSummary: item.evidencePacket?.evidenceSummary ?? null,
      sourceCount: item.evidencePacket?.sourceCount ?? null,
      nextAction: "approve_reject_or_request_more_evidence",
      suggestedApproveCommand: [
        "npm --prefix systems/back run oracle -- approve-resolution-case",
        `--case ${item.oracleCaseId}`,
        "--actor-id <actor-id>",
        '--review-note "<approval note>"',
        `--idempotency-key ${buildIdempotencyKey("approve-resolution", item.oracleCaseId)}`,
        "--json"
      ].join(" "),
      suggestedRejectCommand: [
        "npm --prefix systems/back run oracle -- reject-case",
        `--case ${item.oracleCaseId}`,
        "--actor-id <actor-id>",
        '--review-note "<why rejected>"',
        `--idempotency-key ${buildIdempotencyKey("reject-resolution", item.oracleCaseId)}`,
        "--json"
      ].join(" "),
      suggestedMoreEvidenceCommand: [
        "npm --prefix systems/back run oracle -- request-more-evidence",
        `--case ${item.oracleCaseId}`,
        "--actor-id <actor-id>",
        '--review-note "<what evidence is missing>"',
        `--idempotency-key ${buildIdempotencyKey("more-evidence", item.oracleCaseId)}`,
        "--json"
      ].join(" ")
    })
  );
  const reviewNeededCases = actionableReviewNeededItems.map(
    (item): OracleResolveInboxReviewNeededCaseItem => ({
      itemType: "review_needed_case",
      marketId: item.marketId,
      marketTitle: item.marketTitle,
      oracleCaseId: item.oracleCaseId,
      caseStatus: "review_needed",
      ambiguityLevel: item.ambiguityLevel,
      summary: item.summary,
      evidencePacketId: item.evidencePacket?.evidencePacketId ?? null,
      evidenceSummary: item.evidencePacket?.evidenceSummary ?? null,
      sourceCount: item.evidencePacket?.sourceCount ?? null,
      nextAction: "inspect_resolve_or_void",
      suggestedInspectCommand: [
        "npm --prefix systems/back run oracle -- case-detail",
        `--case ${item.oracleCaseId}`,
        "--json"
      ].join(" "),
      suggestedVoidCommand: [
        "npm --prefix systems/back run oracle -- void-market",
        `--market ${item.marketId}`,
        "--actor-id <actor-id>",
        '--reason "<why this market cannot be resolved safely>"',
        `--idempotency-key ${buildIdempotencyKey("void-market", item.oracleCaseId)}`,
        "--json"
      ].join(" ")
    })
  );

  return {
    objectType: "oracle_resolve_inbox",
    generatedAt: now.toISOString(),
    marketId: options?.marketId ?? null,
    missingCaseCount: missingCases.length,
    recommendedCaseCount: recommendedCases.length,
    reviewNeededCaseCount: reviewNeededCases.length,
    missingCases,
    recommendedCases,
    reviewNeededCases
  };
}
