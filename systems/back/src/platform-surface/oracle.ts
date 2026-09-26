/**
 * platform-surface/oracle.ts
 *
 * This file is the ONLY sanctioned import path from systems/oracle into systems/back.
 * Widening it is a deliberate act — add the symbol here rather than deep-importing.
 *
 * All symbols are re-exported by explicit named re-export (no `export *`) so the
 * surface is auditable at a glance and accidental symbol bleed is prevented.
 * Type-only symbols use `export type`.
 */

// ── db / tx ──────────────────────────────────────────────────────────────────

export type { Queryable } from "../db/client/pool";
export { createDbPool } from "../db/client/pool";
export { withTransaction } from "../db/tx/with-transaction";

// ── env / pool ───────────────────────────────────────────────────────────────

export { loadAppEnv } from "../config/env";

// ── discoverability ──────────────────────────────────────────────────────────

export { pingMarketIndexNow } from "../seo/market-indexnow-service";

// ── actor types ──────────────────────────────────────────────────────────────

export type { RequestActor } from "../auth/actor-resolver";

// ── audit + lifecycle events ─────────────────────────────────────────────────

export { insertAuditEvent } from "../shared/audit-events";
export {
  insertLifecycleEvent,
  type LifecycleEventType,
  type LifecycleEventSourceSystem,
  type InsertLifecycleEventInput,
} from "../shared/lifecycle-events";

// ── idempotency ───────────────────────────────────────────────────────────────

export {
  claimIdempotencyRecord,
  completeIdempotencyRecord,
} from "../shared/idempotency-records";

// ── hashing ───────────────────────────────────────────────────────────────────

export { hashStablePayload } from "../shared/stable-hash";

// ── account ledger ────────────────────────────────────────────────────────────

export { updateAccountBalance } from "../shared/account-balances";
export {
  type AccountRecord,
  readLockedAccountById,
  readLockedPlatformTreasury,
} from "../shared/account-records";
export { readLockedLedgerHead, type LedgerHeadRow } from "../shared/ledger-head";

// ── decimal / math ────────────────────────────────────────────────────────────

export { quantizeMoney, quantizeShares, toDecimal } from "../shared/decimals";

// ── market identity ───────────────────────────────────────────────────────────

export {
  resolveOutcomeKey,
  resolveCanonicalMarketKeyById,
} from "../shared/market-identity";

// ── notifications ───────────────────────────────────────────────────────────

export {
  createResolutionNotifications,
} from "../notifications/notification-feed-service";

// ── horizon close ─────────────────────────────────────────────────────────────

export {
  closeMarket,
  type CloseMarketResponse,
} from "../lifecycle/horizon/close-market-service";
export {
  runHorizonCloseSweep,
  inspectMarketClose,
  readHorizonAlerts,
  type HorizonCloseSweepResult,
  type InspectMarketCloseInput,
  type MarketCloseInspection,
  HORIZON_SYSTEM_ACTOR,
} from "../lifecycle/horizon/close-sweep-service";

// ── lifecycle management ──────────────────────────────────────────────────────

export {
  voidMarket,
  type VoidMarketRequest,
  type VoidMarketResponse,
  VoidMarketServiceError,
} from "../lifecycle/management/void-market-service";
