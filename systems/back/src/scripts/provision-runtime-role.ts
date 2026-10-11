import { createPublicKey, publicEncrypt, randomBytes } from "node:crypto";
import type { Pool } from "pg";
import { createDbPool } from "../db/client/pool";
import { loadAppEnv } from "../config/env";

const identifier = (value: string) => `"${value.replaceAll('"', '""')}"`;

/** Keep the managed owner intact; emit only an operator-encrypted credential. */
export async function provisionRuntimeRole(pool: Pool, publicKeyPem: string) {
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "rsa" || (publicKey.asymmetricKeyDetails?.modulusLength ?? 0) < 3072) {
    throw new Error("operator RSA key must be at least 3072 bits");
  }
  const password = randomBytes(32).toString("base64url");
  const encryptedPassword = publicEncrypt({ key: publicKey, oaepHash: "sha256" }, Buffer.from(password)).toString("base64");
  const client = await pool.connect();
  try {
    await client.query("begin");
    const identity = (await client.query("select current_user as owner, current_database() as db")).rows[0];
    const owner = identifier(identity.owner);
    const database = identifier(identity.db);
    // A rerun fails rather than rotating credentials already used by consumers.
    await client.query(`create role hachozeh_app login nosuperuser nocreatedb nocreaterole noreplication nobypassrls password '${password}'`);
    await client.query(`grant connect on database ${database} to hachozeh_app`);
    await client.query("grant usage on schema public to hachozeh_app");
    await client.query("grant select, insert, update, delete on all tables in schema public to hachozeh_app");
    await client.query("grant usage, select on all sequences in schema public to hachozeh_app");
    await client.query("grant execute on all functions in schema public to hachozeh_app");
    await client.query("revoke insert, update, delete on public.schema_migrations from hachozeh_app");
    await client.query(`alter default privileges for role ${owner} in schema public grant select, insert, update, delete on tables to hachozeh_app`);
    await client.query(`alter default privileges for role ${owner} in schema public grant usage, select on sequences to hachozeh_app`);
    await client.query(`alter default privileges for role ${owner} in schema public grant execute on functions to hachozeh_app`);
    const unsafe = (await client.query(`select
      has_database_privilege('hachozeh_app', current_database(), 'CREATE')
      or exists(select 1 from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'
        and has_schema_privilege('hachozeh_app', oid, 'CREATE'))
      or exists(select 1 from pg_roles where pg_has_role('hachozeh_app', oid, 'MEMBER')
        and (rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolbypassrls))
      or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relkind in ('r','p')
        and (has_table_privilege('hachozeh_app', c.oid, 'TRUNCATE') or has_table_privilege('hachozeh_app', c.oid, 'TRIGGER')))
      or exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.prosecdef and has_function_privilege('hachozeh_app', p.oid, 'EXECUTE'))
      as unsafe`)).rows[0].unsafe;
    if (unsafe) throw new Error("inherited broad privilege or security-definer function requires review");
    await client.query("commit");
    return { role: "hachozeh_app", encryptedPassword, ownerPreserved: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally { client.release(); }
}

if (/provision-runtime-role\.(js|ts)$/.test(process.argv[1] ?? "")) {
  const key = process.argv.find(arg => arg.startsWith("--operator-public-key="))?.split("=").slice(1).join("=");
  if (!key) throw new Error("--operator-public-key=<base64 PEM> required");
  const pool = createDbPool(loadAppEnv().db);
  provisionRuntimeRole(pool, Buffer.from(key, "base64").toString("utf8"))
    .then(result => console.log(JSON.stringify(result)))
    .catch(() => { console.error("runtime role provisioning failed; transaction rolled back; no credential emitted"); process.exitCode = 1; })
    .finally(() => pool.end());
}
