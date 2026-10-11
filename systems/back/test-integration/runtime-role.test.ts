import { generateKeyPairSync, privateDecrypt } from "node:crypto";
import { expect, it } from "vitest";
import { Pool } from "pg";
import { provisionRuntimeRole } from "../src/scripts/provision-runtime-role";
import { createTestPool } from "./helpers";

it("provisions with a non-superuser owner, encrypts the secret and denies runtime DDL", async () => {
  const owner = createTestPool();
  const keys = generateKeyPairSync("rsa", { modulusLength: 3072 });
  let app: Pool | undefined;
  try {
    const result = await provisionRuntimeRole(owner, keys.publicKey.export({ type: "spki", format: "pem" }).toString());
    const password = privateDecrypt({ key: keys.privateKey, oaepHash: "sha256" }, Buffer.from(result.encryptedPassword, "base64")).toString();
    expect(password).toHaveLength(43);
    app = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: result.role, password, max: 1 });
    expect((await app.query("select current_user")).rows[0].current_user).toBe("hachozeh_app");
    await app.query("select * from users limit 1");
    await expect(app.query("create table public.forbidden_role_probe(id int)")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("truncate public.audit_events")).rejects.toMatchObject({ code: "42501" });
    await expect(app.query("update schema_migrations set name=name where false")).rejects.toMatchObject({ code: "42501" });
    await owner.query("create table public.future_role_probe(id int)");
    await app.query("insert into public.future_role_probe values (1)");
    await app.query("update public.future_role_probe set id=2");
    await app.query("delete from public.future_role_probe");
    await owner.query("drop table public.future_role_probe");
    await expect(provisionRuntimeRole(owner, keys.publicKey.export({ type: "spki", format: "pem" }).toString())).rejects.toMatchObject({ code: "42710" });
  } finally {
    await app?.end();
    await owner.query("grant hachozeh_app to current_user");
    await owner.query("drop owned by hachozeh_app");
    await owner.query("drop role hachozeh_app");
    await owner.end();
  }
});
