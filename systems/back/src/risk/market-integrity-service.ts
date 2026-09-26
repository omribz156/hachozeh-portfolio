import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";

import type { Queryable } from "../db/client/pool";
import type { RouteFamily, RateLimitResult } from "../http/rate-limit";
import { resolveClientIp } from "../http/client-ip";
import { insertAuditEvent } from "../shared/audit-events";
import {
  parseObjectBody,
  parseOptionalStringField,
  parseRequiredStringField
} from "../shared/zod-request-body";

export type IntegritySignalSeverity = "observe" | "review" | "block_candidate";

export type IntegritySignalKind =
  | "rate_limit_exceeded"
  | "otp_send_cap_exceeded"
  | "trade_write_rejected"
  | "trade_hammering_pattern"
  | "economy_grant_rejected";

export type IntegrityReviewStatus = "reviewed" | "dismissed" | "escalated";

type IntegritySignalInput = {
  kind: IntegritySignalKind;
  severity: IntegritySignalSeverity;
  endpointFamily: string;
  method: string;
  path: string;
  actorId?: string | null;
  sessionId?: string | null;
  ip?: string | null;
  reasonCode: string;
  details?: Record<string, unknown>;
};

type IntegritySignalRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  payload: Record<string, unknown>;
  created_at: Date;
  review_status?: IntegrityReviewStatus | null;
  reviewed_at?: Date | null;
  reviewed_by?: string | null;
  review_note?: string | null;
};

export type IntegritySignal = {
  id: string;
  subject: string;
  subjectType: string;
  kind: string;
  severity: IntegritySignalSeverity;
  endpointFamily: string;
  method: string;
  path: string;
  reasonCode: string;
  recommendedResponse: string;
  createdAt: string;
  details: Record<string, unknown>;
  review: {
    status: IntegrityReviewStatus | null;
    reviewedAt: string | null;
    reviewedBy: string | null;
    note: string | null;
  };
};

type IntegritySummaryCountRow = {
  key: string | null;
  count: number;
};

type IntegrityOpenReviewRow = {
  open_review_count: number;
};

export type IntegritySignalSummary = {
  windowHours: number;
  generatedAt: string;
  total: number;
  openReviewCount: number;
  bySeverity: Record<string, number>;
  byFamily: Record<string, number>;
  byReason: Record<string, number>;
};

export class MarketIntegrityServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "MarketIntegrityServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const RISK_MONITOR_ACTOR_ID = "system:risk-monitor";

export const ENDPOINT_ABUSE_POLICIES: Record<
  string,
  {
    defaultSeverity: IntegritySignalSeverity;
    posture: "audit_only" | "review_needed" | "block_candidate";
    response: string;
  }
> = {
  market_read: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Watch for scrape pressure; block only after repeated or service-impacting pressure."
  },
  portfolio_read: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Review if a signed-in account repeatedly hammers account reads."
  },
  session_read: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Watch for session-check pressure; tune edge limits before treating it as account abuse."
  },
  trade_write: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review actor, market, and recent trades; use trade-block or lock only with supporting evidence."
  },
  auth_write: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review auth pressure before user action; prefer cooldown and observation before account lock."
  },
  auth_verify: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review OTP verification pressure; repeated failures can indicate brute-force or scripted login attempts."
  },
  auth_otp_send: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review OTP pressure and quota burn; throttle first, then lock only if account-linked abuse repeats."
  },
  account_write: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review account mutation pressure; protect profile, session, export, deletion, and avatar surfaces."
  },
  comment_write: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Watch for comment spam pressure; moderate content separately from account restrictions."
  },
  feedback_write: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Watch for spam pressure; moderate content separately from account restrictions."
  },
  social_write: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Watch for follow/unfollow automation; restrict only after repeated or coordinated abuse."
  },
  wallet_write: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review faucet or claim pressure before reversing grants or restricting accounts."
  },
  admin_write: {
    defaultSeverity: "block_candidate",
    posture: "block_candidate",
    response: "Investigate immediately; admin write pressure can indicate automation or compromised operator access."
  },
  oracle_write: {
    defaultSeverity: "block_candidate",
    posture: "block_candidate",
    response: "Investigate immediately; Oracle writes affect trust and market lifecycle."
  },
  general_request: {
    defaultSeverity: "observe",
    posture: "audit_only",
    response: "Watch for unknown API probing or script floods; add a specific route family if the path becomes real."
  },
  economy_grant: {
    defaultSeverity: "review",
    posture: "review_needed",
    response: "Review faucet or grant pressure before reversing grants or restricting accounts."
  }
};

function hashIp(ip: string | null | undefined): string | null {
  const value = ip?.trim();
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function readRequestPath(request: IncomingMessage): string {
  return (request.url ?? "/").split("?")[0] || "/";
}

function readUserAgent(request: IncomingMessage): string | null {
  const value = request.headers["user-agent"]?.toString().trim();
  if (!value) {
    return null;
  }

  return value.slice(0, 180);
}

// The privacy policy commits to storing device/User-Agent details hashed-only (never the raw
// value), consistent with how the IP is treated. Risk signals only need a stable fingerprint to
// correlate abuse, not the readable string — so hash before persisting.
function hashUserAgent(request: IncomingMessage): string | null {
  const value = readUserAgent(request);
  if (!value) {
    return null;
  }

  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

function buildSubject(input: IntegritySignalInput): {
  entityType: string;
  entityId: string;
  subject: string;
} {
  const actorId = input.actorId?.trim();
  if (actorId) {
    return {
      entityType: "user",
      entityId: actorId,
      subject: `actor:${actorId}`
    };
  }

  const sessionId = input.sessionId?.trim();
  if (sessionId) {
    return {
      entityType: "session",
      entityId: sessionId,
      subject: `session:${sessionId}`
    };
  }

  const ipHash = hashIp(input.ip) ?? "unknown";

  return {
    entityType: "risk_subject",
    entityId: `ip:${ipHash}`,
    subject: `ip:${ipHash}`
  };
}

function readPolicyResponse(endpointFamily: string): string {
  return (
    ENDPOINT_ABUSE_POLICIES[endpointFamily]?.response ??
    "Review the signal before taking account action."
  );
}

function createMarketIntegrityRequestError(message: string): MarketIntegrityServiceError {
  return new MarketIntegrityServiceError(400, "invalid_request", message);
}

function readReviewRequest(body: unknown): {
  status: IntegrityReviewStatus;
  note: string | null;
} {
  const record = parseObjectBody(
    body,
    "Review body must be a JSON object.",
    createMarketIntegrityRequestError
  );
  const status = parseRequiredStringField(record, "status", createMarketIntegrityRequestError);
  const note = parseOptionalStringField(record, "note", createMarketIntegrityRequestError);

  if (!["reviewed", "dismissed", "escalated"].includes(status)) {
    throw new MarketIntegrityServiceError(
      400,
      "invalid_request",
      "Review status must be reviewed, dismissed, or escalated."
    );
  }

  if (note && note.length > 280) {
    throw new MarketIntegrityServiceError(
      400,
      "invalid_request",
      "Review note must be 280 characters or less."
    );
  }

  return {
    status: status as IntegrityReviewStatus,
    note: note ?? null
  };
}

export function classifyRateLimitSignal(
  result: Pick<RateLimitResult, "family">
): {
  kind: IntegritySignalKind;
  severity: IntegritySignalSeverity;
} {
  if (result.family === "auth_otp_send") {
    return {
      kind: "otp_send_cap_exceeded",
      severity: "review"
    };
  }

  return {
    kind: "rate_limit_exceeded",
    severity: ENDPOINT_ABUSE_POLICIES[result.family]?.defaultSeverity ?? "observe"
  };
}

export async function recordIntegritySignal(
  db: Queryable,
  input: IntegritySignalInput
): Promise<string> {
  const subject = buildSubject(input);
  const ipHash = hashIp(input.ip);

  return insertAuditEvent(db, {
    actorId: RISK_MONITOR_ACTOR_ID,
    action: "risk.signal.recorded",
    entityType: subject.entityType,
    entityId: subject.entityId,
    payload: {
      signalId: `risk_${randomUUID()}`,
      subject: subject.subject,
      kind: input.kind,
      severity: input.severity,
      endpointFamily: input.endpointFamily,
      method: input.method,
      path: input.path,
      reasonCode: input.reasonCode,
      ipHash,
      recommendedResponse: readPolicyResponse(input.endpointFamily),
      details: input.details ?? {}
    }
  });
}

export async function recordRateLimitIntegritySignal(
  db: Queryable,
  request: IncomingMessage,
  result: RateLimitResult,
  context?: {
    actorId?: string | null;
    sessionId?: string | null;
  }
): Promise<string> {
  const classification = classifyRateLimitSignal(result);

  return recordIntegritySignal(db, {
    kind: classification.kind,
    severity: classification.severity,
    endpointFamily: result.family,
    method: request.method ?? "UNKNOWN",
    path: readRequestPath(request),
    actorId: context?.actorId,
    sessionId: context?.sessionId,
    ip: resolveClientIp(request),
    reasonCode: "rate_limited",
    details: {
      limit: result.limit,
      retryAfterSeconds: result.retryAfterSeconds,
      remaining: result.remaining,
      userAgentHash: hashUserAgent(request)
    }
  });
}

export async function recordTradeWriteRejectionSignal(
  db: Queryable,
  request: IncomingMessage,
  input: {
    actorId?: string | null;
    sessionId?: string | null;
    marketKey: string;
    operation: "quote" | "trade";
    reasonCode: string;
    statusCode: number;
  }
): Promise<string | null> {
  if (
    ![
      "market_state_version_mismatch",
      "trade_access_blocked",
      "invalid_request",
      "unauthorized"
    ].includes(input.reasonCode)
  ) {
    return null;
  }

  const signalId = await recordIntegritySignal(db, {
    kind: "trade_write_rejected",
    severity: input.reasonCode === "market_state_version_mismatch" ? "observe" : "review",
    endpointFamily: "trade_write",
    method: request.method ?? "UNKNOWN",
    path: readRequestPath(request),
    actorId: input.actorId,
    sessionId: input.sessionId,
    ip: resolveClientIp(request),
    reasonCode: input.reasonCode,
    details: {
      marketKey: input.marketKey,
      operation: input.operation,
      statusCode: input.statusCode,
      userAgentHash: hashUserAgent(request)
    }
  });

  if (input.actorId && input.reasonCode !== "market_state_version_mismatch") {
    await recordTradeHammeringPatternIfNeeded(db, {
      actorId: input.actorId,
      marketKey: input.marketKey,
      operation: input.operation,
      reasonCode: input.reasonCode
    });
  }

  return signalId;
}

export async function recordEconomyGrantRejectionSignal(
  db: Queryable,
  input: {
    actorId: string;
    faucetType: "daily_login" | "emergency_bankruptcy" | "starter_grant";
    reasonCode: string;
    statusCode: number;
    path: string;
  }
): Promise<string | null> {
  if (!["emergency_faucet_cooldown", "emergency_faucet_not_eligible"].includes(input.reasonCode)) {
    return null;
  }

  return recordIntegritySignal(db, {
    kind: "economy_grant_rejected",
    severity: input.reasonCode === "emergency_faucet_cooldown" ? "review" : "observe",
    endpointFamily: "economy_grant",
    method: "POST",
    path: input.path,
    actorId: input.actorId,
    reasonCode: input.reasonCode,
    details: {
      faucetType: input.faucetType,
      statusCode: input.statusCode
    }
  });
}

async function recordTradeHammeringPatternIfNeeded(
  db: Queryable,
  input: {
    actorId: string;
    marketKey: string;
    operation: "quote" | "trade";
    reasonCode: string;
  }
): Promise<string | null> {
  const result = await db.query<{ recent_count: number; existing_pattern_count: number }>(
    `
      select
        count(*) filter (
          where payload->>'kind' = 'trade_write_rejected'
            and created_at >= now() - interval '10 minutes'
        )::int as recent_count,
        count(*) filter (
          where payload->>'kind' = 'trade_hammering_pattern'
            and created_at >= now() - interval '10 minutes'
        )::int as existing_pattern_count
      from audit_events
      where action = 'risk.signal.recorded'
        and entity_type = 'user'
        and entity_id = $1
        and payload->>'endpointFamily' = 'trade_write'
    `,
    [input.actorId]
  );
  const row = result.rows[0];
  const recentCount = Number(row?.recent_count ?? 0);
  const existingPatternCount = Number(row?.existing_pattern_count ?? 0);

  if (recentCount < 5 || existingPatternCount > 0) {
    return null;
  }

  return recordIntegritySignal(db, {
    kind: "trade_hammering_pattern",
    severity: "review",
    endpointFamily: "trade_write",
    method: "POST",
    path: "/api/markets/:market/trades",
    actorId: input.actorId,
    reasonCode: "repeated_trade_rejections",
    details: {
      recentCount,
      windowMinutes: 10,
      latestMarketKey: input.marketKey,
      latestOperation: input.operation,
      latestReasonCode: input.reasonCode
    }
  });
}

function normalizePayload(payload: Record<string, unknown>): {
  kind: string;
  severity: IntegritySignalSeverity;
  endpointFamily: string;
  method: string;
  path: string;
  reasonCode: string;
  recommendedResponse: string;
  details: Record<string, unknown>;
} {
  const severity =
    payload.severity === "observe" ||
    payload.severity === "review" ||
    payload.severity === "block_candidate"
      ? payload.severity
      : "observe";

  return {
    kind: typeof payload.kind === "string" ? payload.kind : "unknown",
    severity,
    endpointFamily:
      typeof payload.endpointFamily === "string" ? payload.endpointFamily : "unknown",
    method: typeof payload.method === "string" ? payload.method : "UNKNOWN",
    path: typeof payload.path === "string" ? payload.path : "/",
    reasonCode: typeof payload.reasonCode === "string" ? payload.reasonCode : "unknown",
    recommendedResponse:
      typeof payload.recommendedResponse === "string"
        ? payload.recommendedResponse
        : "Review the signal before taking account action.",
    details:
      payload.details && typeof payload.details === "object" && !Array.isArray(payload.details)
        ? (payload.details as Record<string, unknown>)
        : {}
  };
}

export async function readIntegritySignals(
  db: Queryable,
  options?: {
    limit?: number;
    subject?: string | null;
  }
): Promise<{
  signals: IntegritySignal[];
  policy: typeof ENDPOINT_ABUSE_POLICIES;
}> {
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), 100);
  const subject = options?.subject?.trim();
  const values: Array<string | number> = [limit];
  const subjectClause = subject ? "and entity_id = $2" : "";

  if (subject) {
    values.push(subject);
  }

  const result = await db.query<IntegritySignalRow>(
    `
      select
        signal.id,
        signal.entity_type,
        signal.entity_id,
        signal.payload,
        signal.created_at,
        review.payload->>'status' as review_status,
        review.created_at as reviewed_at,
        review.actor_id as reviewed_by,
        review.payload->>'note' as review_note
      from audit_events signal
      left join lateral (
        select
          actor_id,
          payload,
          created_at
        from audit_events
        where action = 'risk.signal.reviewed'
          and entity_type = 'risk_signal'
          and entity_id = signal.id
        order by created_at desc
        limit 1
      ) review
        on true
      where signal.action = 'risk.signal.recorded'
        ${subjectClause}
      order by signal.created_at desc
      limit $1
    `,
    values
  );

  return {
    signals: result.rows.map((row) => {
      const payload = normalizePayload(row.payload ?? {});
      return {
        id: row.id,
        subject: typeof row.payload.subject === "string" ? row.payload.subject : row.entity_id,
        subjectType: row.entity_type,
        kind: payload.kind,
        severity: payload.severity,
        endpointFamily: payload.endpointFamily,
        method: payload.method,
        path: payload.path,
        reasonCode: payload.reasonCode,
        recommendedResponse: payload.recommendedResponse,
        createdAt: row.created_at.toISOString(),
        details: payload.details,
        review: {
          status:
            row.review_status === "reviewed" ||
            row.review_status === "dismissed" ||
            row.review_status === "escalated"
              ? row.review_status
              : null,
          reviewedAt: row.reviewed_at?.toISOString() ?? null,
          reviewedBy: row.reviewed_by ?? null,
          note: row.review_note ?? null
        }
      };
    }),
    policy: ENDPOINT_ABUSE_POLICIES
  };
}

function mapCountRows(rows: IntegritySummaryCountRow[]): Record<string, number> {
  return Object.fromEntries(rows.map((row) => [row.key ?? "unknown", Number(row.count)]));
}

export async function readIntegritySignalSummary(
  db: Queryable,
  options?: {
    windowHours?: number;
  }
): Promise<IntegritySignalSummary> {
  const windowHours = Math.min(Math.max(options?.windowHours ?? 24, 1), 24 * 30);
  const values = [windowHours];
  const [severityResult, familyResult, reasonResult, openReviewResult] = await Promise.all([
    db.query<IntegritySummaryCountRow>(
      `
        select payload->>'severity' as key, count(*)::int as count
        from audit_events
        where action = 'risk.signal.recorded'
          and created_at >= now() - ($1::int * interval '1 hour')
        group by key
      `,
      values
    ),
    db.query<IntegritySummaryCountRow>(
      `
        select payload->>'endpointFamily' as key, count(*)::int as count
        from audit_events
        where action = 'risk.signal.recorded'
          and created_at >= now() - ($1::int * interval '1 hour')
        group by key
      `,
      values
    ),
    db.query<IntegritySummaryCountRow>(
      `
        select payload->>'reasonCode' as key, count(*)::int as count
        from audit_events
        where action = 'risk.signal.recorded'
          and created_at >= now() - ($1::int * interval '1 hour')
        group by key
      `,
      values
    ),
    db.query<IntegrityOpenReviewRow>(
      `
        select count(*)::int as open_review_count
        from audit_events signal
        where signal.action = 'risk.signal.recorded'
          and signal.created_at >= now() - ($1::int * interval '1 hour')
          and signal.payload->>'severity' in ('review', 'block_candidate')
          and not exists (
            select 1
            from audit_events review
            where review.action = 'risk.signal.reviewed'
              and review.entity_type = 'risk_signal'
              and review.entity_id = signal.id
          )
      `,
      values
    )
  ]);
  const bySeverity = mapCountRows(severityResult.rows);
  const total = Object.values(bySeverity).reduce((sum, count) => sum + count, 0);

  return {
    windowHours,
    generatedAt: new Date().toISOString(),
    total,
    openReviewCount: Number(openReviewResult.rows[0]?.open_review_count ?? 0),
    bySeverity,
    byFamily: mapCountRows(familyResult.rows),
    byReason: mapCountRows(reasonResult.rows)
  };
}

export async function reviewIntegritySignal(
  db: Queryable,
  input: {
    signalId: string;
    actorId: string;
    body: unknown;
  }
): Promise<{
  signalId: string;
  status: IntegrityReviewStatus;
  note: string | null;
  reviewedBy: string;
  auditEventId: string;
}> {
  const request = readReviewRequest(input.body);
  const existing = await db.query<{ id: string }>(
    `
      select id
      from audit_events
      where id = $1
        and action = 'risk.signal.recorded'
      limit 1
    `,
    [input.signalId]
  );

  if (!existing.rows[0]) {
    throw new MarketIntegrityServiceError(
      404,
      "risk_signal_not_found",
      "Requested risk signal was not found."
    );
  }

  const auditEventId = await insertAuditEvent(db, {
    actorId: input.actorId,
    action: "risk.signal.reviewed",
    entityType: "risk_signal",
    entityId: input.signalId,
    payload: {
      status: request.status,
      note: request.note
    }
  });

  return {
    signalId: input.signalId,
    status: request.status,
    note: request.note,
    reviewedBy: input.actorId,
    auditEventId
  };
}
