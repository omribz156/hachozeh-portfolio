import type { CloseAuditRow, LifecycleMarketRow } from "./lifecycle-run-read-model";

export type CloseProvenanceItem = {
  marketId: string;
  marketTitle: string;
  marketStatus: "closed" | "resolved";
  closeAt: string | null;
  closedAt: string | null;
  resolvedAt: string | null;
  provenanceStatus: "confirmed" | "missing" | "invalid";
  triggerType: string | null;
  auditEventId: string | null;
  actorId: string | null;
  sourceRef: string | null;
  reason: string;
};

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readNestedString(value: unknown, path: string[]): string | null {
  let cursor: unknown = value;

  for (const part of path) {
    const object = readObject(cursor);
    cursor = object[part];
  }

  return typeof cursor === "string" && cursor.trim().length > 0
    ? cursor.trim()
    : null;
}

function baseProvenanceItem(market: LifecycleMarketRow): Pick<
  CloseProvenanceItem,
  "marketId" | "marketTitle" | "marketStatus" | "closeAt" | "closedAt" | "resolvedAt"
> {
  return {
    marketId: market.id,
    marketTitle: market.title,
    marketStatus: market.status,
    closeAt: market.close_at?.toISOString() ?? null,
    closedAt: market.closed_at?.toISOString() ?? null,
    resolvedAt: market.resolved_at?.toISOString() ?? null
  };
}

export function mapCloseProvenanceItem(
  market: LifecycleMarketRow,
  audit: CloseAuditRow | undefined
): CloseProvenanceItem {
  if (!audit) {
    return {
      ...baseProvenanceItem(market),
      provenanceStatus: "missing",
      triggerType: null,
      auditEventId: null,
      actorId: null,
      sourceRef: null,
      reason: "Closed market has no market_closed audit event; resolution intake is blocked."
    };
  }

  const triggerType =
    readNestedString(audit.payload, ["command", "triggerType"]) ??
    readNestedString(audit.payload, ["result", "triggerType"]);
  const sourceRef = readNestedString(audit.payload, ["command", "sourceRef"]);
  const reason =
    readNestedString(audit.payload, ["command", "notes"]) ??
    readNestedString(audit.payload, ["check", "decisionSummary"]) ??
    "Close provenance confirmed by market_closed audit event.";
  const closeAtMs = market.close_at?.getTime() ?? null;
  const closedAtMs = market.closed_at?.getTime() ?? null;

  if (
    triggerType === "scheduled_time" &&
    closeAtMs != null &&
    closedAtMs != null &&
    closedAtMs < closeAtMs
  ) {
    return {
      ...baseProvenanceItem(market),
      provenanceStatus: "invalid",
      triggerType,
      auditEventId: audit.audit_event_id,
      actorId: audit.actor_id,
      sourceRef,
      reason:
        "Close audit says scheduled_time, but market closed before close_at; resolution intake is blocked until close provenance is repaired."
    };
  }

  return {
    ...baseProvenanceItem(market),
    provenanceStatus: "confirmed",
    triggerType,
    auditEventId: audit.audit_event_id,
    actorId: audit.actor_id,
    sourceRef,
    reason
  };
}
