import type { HorizonMarketLifecycle } from "./contracts";

export type HorizonMarketLifecycleRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
  open_at: Date;
  close_at: Date;
  close_on_event_completion: boolean;
  event_completion_close_requires_human_approval: boolean;
  closed_at: Date | null;
  resolved_at: Date | null;
};

export function toHorizonLifecycleMarket(row: HorizonMarketLifecycleRow): HorizonMarketLifecycle {
  return {
    marketId: row.id,
    status: row.status,
    openAt: row.open_at.toISOString(),
    closeAt: row.close_at.toISOString(),
    closeOnEventCompletion: row.close_on_event_completion,
    eventCompletionCloseRequiresHumanApproval: row.event_completion_close_requires_human_approval,
    closedAt: row.closed_at?.toISOString() ?? null,
    resolvedAt: row.resolved_at?.toISOString() ?? null
  };
}
