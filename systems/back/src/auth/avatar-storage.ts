// Avatar object storage — Cloudflare R2 (S3-compatible) when the R2_* env is configured,
// otherwise the local upload dir. R2 keeps avatars off the (ephemeral on Render) container
// filesystem; local disk stays the DEFAULT so dev and a single-VPS run are unchanged.
//
// The S3 client is imported lazily, so `@aws-sdk/client-s3` is only loaded — and only needs
// to be installed — when R2 is actually configured.
import { mkdir, readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

import { readAvatarR2Config, type R2StorageConfig } from "../storage/object-storage-config";

const AVATAR_UPLOAD_DIR = resolve(process.cwd(), "workspace", "runtime", "uploads", "avatars");
const R2_KEY_PREFIX = "avatars/";

let cachedClient: unknown = null;
async function r2Client(config: R2StorageConfig): Promise<{ send(command: unknown): Promise<unknown> }> {
  if (cachedClient) {
    return cachedClient as { send(command: unknown): Promise<unknown> };
  }
  // @ts-ignore optional dependency, installed in the production (R2) build
  const { S3Client } = await import("@aws-sdk/client-s3");
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  });
  return cachedClient as { send(command: unknown): Promise<unknown> };
}

export async function putAvatar(fileName: string, buffer: Buffer): Promise<void> {
  const config = readAvatarR2Config();
  if (config) {
    const client = await r2Client(config);
    // @ts-ignore optional dependency, installed in the production (R2) build
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: `${R2_KEY_PREFIX}${fileName}`,
        Body: buffer,
        ContentType: "image/webp",
        CacheControl: "public, max-age=31536000, immutable"
      })
    );
    return;
  }

  await mkdir(AVATAR_UPLOAD_DIR, { recursive: true });
  await writeFile(join(AVATAR_UPLOAD_DIR, fileName), buffer, { flag: "wx" });
}

export async function readAvatar(fileName: string): Promise<Buffer | null> {
  const config = readAvatarR2Config();
  if (config) {
    const client = await r2Client(config);
    // @ts-ignore optional dependency, installed in the production (R2) build
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      const output = (await client.send(
        new GetObjectCommand({ Bucket: config.bucket, Key: `${R2_KEY_PREFIX}${fileName}` })
      )) as { Body: { transformToByteArray(): Promise<Uint8Array> } };
      return Buffer.from(await output.Body.transformToByteArray());
    } catch (error) {
      const e = error as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  return readFile(join(AVATAR_UPLOAD_DIR, fileName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
}

export async function deleteAvatar(fileName: string, opts?: { localDir?: string }): Promise<void> {
  const config = readAvatarR2Config();
  if (config) {
    const client = await r2Client(config);
    // @ts-ignore optional dependency, installed in the production (R2) build
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: `${R2_KEY_PREFIX}${fileName}` })
    );
    return;
  }

  await unlink(join(opts?.localDir ?? AVATAR_UPLOAD_DIR, fileName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}

export type StoredAvatar = { fileName: string; lastModified: Date | null };

// List every stored avatar (R2 when configured, else the local upload dir) with its last-modified
// time, so the privacy-retention sweep can reconcile against `users.avatar_url` and reclaim
// orphans wherever they actually live — not just on local disk.
export async function listAvatars(opts?: { localDir?: string }): Promise<StoredAvatar[]> {
  const config = readAvatarR2Config();
  if (config) {
    const client = await r2Client(config);
    // @ts-ignore optional dependency, installed in the production (R2) build
    const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
    const items: StoredAvatar[] = [];
    let token: string | undefined;
    do {
      const out = (await client.send(
        new ListObjectsV2Command({ Bucket: config.bucket, Prefix: R2_KEY_PREFIX, ContinuationToken: token })
      )) as {
        Contents?: Array<{ Key?: string; LastModified?: Date }>;
        IsTruncated?: boolean;
        NextContinuationToken?: string;
      };
      for (const obj of out.Contents ?? []) {
        const key = obj.Key ?? "";
        if (!key.startsWith(R2_KEY_PREFIX)) continue;
        const fileName = key.slice(R2_KEY_PREFIX.length);
        if (!fileName) continue;
        items.push({ fileName, lastModified: obj.LastModified ?? null });
      }
      token = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (token);
    return items;
  }

  const dir = opts?.localDir ?? AVATAR_UPLOAD_DIR;
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const items: StoredAvatar[] = [];
  for (const entry of entries) {
    const fileName = basename(entry);
    if (!fileName) continue;
    const stats = await stat(join(dir, fileName)).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!stats?.isFile()) continue;
    items.push({ fileName, lastModified: stats.mtime });
  }
  return items;
}
