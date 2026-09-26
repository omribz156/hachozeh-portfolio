import { randomUUID } from "node:crypto";

import type { Queryable } from "../../back/src/platform-surface/oracle";

export type OracleRuntimeSnapshotType =
  | "heartbeat"
  | "alerts"
  | "lifecycle-heartbeat"
  | "horizon-scheduler";
export type OracleRuntimeSnapshotSummary = {
  snapshotId: string;
  runtimeType: OracleRuntimeSnapshotType;
  marketStatusFilter: "open" | "closed" | "all";
  generatedAt: string;
  summarySnapshot: Record<string, unknown>;
};

export type PersistOracleRuntimeSnapshotInput = {
  runtimeType: OracleRuntimeSnapshotType;
  marketStatusFilter: "open" | "closed" | "all";
  generatedAt: string;
  summarySnapshot: Record<string, unknown>;
  payloadSnapshot: Record<string, unknown>;
};

type OracleRuntimeSnapshotRow = {
  id: string;
  runtime_type: OracleRuntimeSnapshotType;
  market_status_filter: "open" | "closed" | "all";
  generated_at: Date;
  summary_snapshot: Record<string, unknown> | null;
};

export async function persistOracleRuntimeSnapshot(
  db: Queryable,
  input: PersistOracleRuntimeSnapshotInput
): Promise<string> {
  const snapshotId = `orsnap_${randomUUID()}`;

  await db.query(
    `
      insert into oracle_runtime_snapshots (
        id,
        runtime_type,
        market_status_filter,
        generated_at,
        summary_snapshot,
        payload_snapshot
      )
      values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
    `,
    [
      snapshotId,
      input.runtimeType,
      input.marketStatusFilter,
      input.generatedAt,
      JSON.stringify(input.summarySnapshot),
      JSON.stringify(input.payloadSnapshot)
    ]
  );

  return snapshotId;
}

export async function readRecentOracleRuntimeSnapshots(
  db: Queryable,
  options: {
    limit?: number;
    runtimeTypes?: OracleRuntimeSnapshotType[];
  } = {}
): Promise<OracleRuntimeSnapshotSummary[]> {
  const limit =
    Number.isFinite(options.limit) && (options.limit ?? 0) > 0
      ? Math.min(Math.trunc(options.limit ?? 0), 10)
      : 6;
  const runtimeTypes =
    Array.isArray(options.runtimeTypes) && options.runtimeTypes.length > 0
      ? options.runtimeTypes
      : null;
  const result = runtimeTypes
    ? await db.query<OracleRuntimeSnapshotRow>(
        `
          select
            id,
            runtime_type,
            market_status_filter,
            generated_at,
            summary_snapshot
          from oracle_runtime_snapshots
          where runtime_type = any($1::text[])
          order by generated_at desc, created_at desc
          limit $2
        `,
        [runtimeTypes, limit]
      )
    : await db.query<OracleRuntimeSnapshotRow>(
        `
          select
            id,
            runtime_type,
            market_status_filter,
            generated_at,
            summary_snapshot
          from oracle_runtime_snapshots
          order by generated_at desc, created_at desc
          limit $1
        `,
        [limit]
      );

  return result.rows.map((row) => ({
    snapshotId: row.id,
    runtimeType: row.runtime_type,
    marketStatusFilter: row.market_status_filter,
    generatedAt: row.generated_at.toISOString(),
    summarySnapshot:
      row.summary_snapshot && typeof row.summary_snapshot === "object"
        ? row.summary_snapshot
        : {}
  }));
}
