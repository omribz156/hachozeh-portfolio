import { randomUUID } from "node:crypto";

import type { Queryable } from "../db/client/pool";

export async function insertAuditEvent(
  db: Queryable,
  input: {
    actorId: string;
    action: string;
    entityType: string;
    entityId: string;
    payload: unknown;
  }
): Promise<string> {
  const auditEventId = `audit_${randomUUID()}`;

  await db.query(
    `
      insert into audit_events (id, actor_id, action, entity_type, entity_id, payload, created_at)
      values ($1, $2, $3, $4, $5, $6::jsonb, now())
    `,
    [
      auditEventId,
      input.actorId,
      input.action,
      input.entityType,
      input.entityId,
      JSON.stringify(input.payload)
    ]
  );

  return auditEventId;
}
