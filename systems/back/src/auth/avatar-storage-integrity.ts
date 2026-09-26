import { basename } from "node:path";

import type { Queryable } from "../db/client/pool";
import { sanitizePublicAvatarUrl } from "../shared/public-avatar-url";
import { listAvatars, type StoredAvatar } from "./avatar-storage";

const AVATAR_PUBLIC_PREFIX = "/api/uploads/avatars/";

export type AvatarStorageIntegrityReport = {
  objectType: "avatar_storage_integrity_report";
  generatedAt: string;
  verdict: "ok" | "bad";
  databaseReferenceCount: number;
  referencedObjectCount: number;
  storedObjectCount: number;
  danglingReferenceCount: number;
  invalidReferenceCount: number;
  unreferencedObjectCount: number;
};

type AvatarStorageIntegrityDeps = {
  listStoredAvatars?: () => Promise<StoredAvatar[]>;
};

export async function auditAvatarStorageIntegrity(
  db: Queryable,
  deps: AvatarStorageIntegrityDeps = {}
): Promise<AvatarStorageIntegrityReport> {
  const references = await db.query<{ avatar_url: string | null }>(
    `
      select avatar_url
      from users
      where avatar_url is not null
    `
  );
  const stored = await (deps.listStoredAvatars ?? listAvatars)();
  const storedNames = new Set(stored.map((item) => basename(item.fileName)).filter(Boolean));
  const referencedNames = new Set<string>();
  let invalidReferenceCount = 0;

  for (const row of references.rows) {
    const safeUrl = sanitizePublicAvatarUrl(row.avatar_url);
    if (!safeUrl) {
      invalidReferenceCount += 1;
      continue;
    }
    referencedNames.add(safeUrl.slice(AVATAR_PUBLIC_PREFIX.length));
  }

  let danglingReferenceCount = 0;
  for (const name of referencedNames) {
    if (!storedNames.has(name)) danglingReferenceCount += 1;
  }

  let unreferencedObjectCount = 0;
  for (const name of storedNames) {
    if (!referencedNames.has(name)) unreferencedObjectCount += 1;
  }

  return {
    objectType: "avatar_storage_integrity_report",
    generatedAt: new Date().toISOString(),
    verdict: danglingReferenceCount > 0 || invalidReferenceCount > 0 ? "bad" : "ok",
    databaseReferenceCount: references.rows.length,
    referencedObjectCount: referencedNames.size,
    storedObjectCount: storedNames.size,
    danglingReferenceCount,
    invalidReferenceCount,
    unreferencedObjectCount
  };
}
