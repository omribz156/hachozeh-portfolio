import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { readCurrentUserDataExport } from "../src/auth/current-user-data-export-service";
import { revokeCurrentUserSessionById } from "../src/auth/current-user-session-revoke-service";
import { createTestPool, truncateAllTables } from "./helpers";

let pool: Pool;
beforeEach(async () => {
  pool = createTestPool();
  await truncateAllTables(pool);
  for (const id of ["isolation_a", "isolation_b"]) {
    await pool.query("insert into users(id, handle, status, role, trade_access_status) values ($1,$1,'active','user','enabled')", [id]);
    await pool.query("insert into user_identities(id,user_id,type,identifier_normalized,identifier_display,status) values ($1,$2,'email',$3,$3,'active')", [`identity_${id}`,id,`${id}@example.invalid`]);
    await pool.query("insert into sessions(id,user_id,status,token_hash,expires_at) values ($1,$2,'active',$1,now()+interval '1 hour')", [`session_${id}`, id]);
  }
});
afterEach(async () => { if (pool) await pool.end(); });

describe("two-user database isolation", () => {
  it("exports only the requested actor's private identity", async () => {
    const result = await readCurrentUserDataExport(pool, "isolation_a");
    expect(result.user?.id).toBe("isolation_a");
    expect(result.identities.map(identity => identity.identifier)).toEqual(["isolation_a@example.invalid"]);
    expect(JSON.stringify(result)).not.toContain("isolation_b");
  });
  it("cannot revoke another user's session", async () => {
    await expect(revokeCurrentUserSessionById(pool, "isolation_a", "session_isolation_a", "session_isolation_b", {}))
      .rejects.toMatchObject({ code: "session_not_found" });
    const result = await pool.query("select status from sessions where id = 'session_isolation_b'");
    expect(result.rows[0].status).toBe("active");
  });
});
