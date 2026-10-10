// Feedback image object storage — Cloudflare R2 when configured, local disk otherwise.
// Mirrors avatar-storage.ts but uses a separate bucket env and the `feedback/` key prefix.
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { readFeedbackR2Config, type R2StorageConfig } from "../storage/object-storage-config";

const FEEDBACK_IMAGE_UPLOAD_DIR = resolve(
  process.cwd(),
  "workspace",
  "runtime",
  "uploads",
  "feedback"
);
const R2_KEY_PREFIX = "feedback/";

let cachedClient: unknown = null;
function validateFileName(fileName: string): void {
  if (fileName.length > 160 || !fileName.endsWith(".webp") || !/^feedback-[a-zA-Z0-9_-]+\.webp$/.test(fileName)) {
    throw new Error("Invalid feedback image filename");
  }
}
function localImagePath(fileName: string): string {
  const filePath = resolve(FEEDBACK_IMAGE_UPLOAD_DIR, fileName);
  if (!filePath.startsWith(FEEDBACK_IMAGE_UPLOAD_DIR + sep)) {
    throw new Error("Invalid feedback image path");
  }
  return filePath;
}
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

export async function putFeedbackImage(fileName: string, buffer: Buffer): Promise<void> {
  validateFileName(fileName);
  const config = readFeedbackR2Config();
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
        CacheControl: "private, max-age=0, no-store"
      })
    );
    return;
  }

  await mkdir(FEEDBACK_IMAGE_UPLOAD_DIR, { recursive: true });
  await writeFile(localImagePath(fileName), buffer, { flag: "wx" });
}

export async function readFeedbackImage(fileName: string): Promise<Buffer | null> {
  validateFileName(fileName);
  const config = readFeedbackR2Config();
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

  return readFile(localImagePath(fileName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  });
}

export async function deleteFeedbackImage(fileName: string): Promise<void> {
  validateFileName(fileName);
  const config = readFeedbackR2Config();
  if (config) {
    const client = await r2Client(config);
    // @ts-ignore optional dependency, installed in the production (R2) build
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: `${R2_KEY_PREFIX}${fileName}` })
    );
    return;
  }

  await unlink(localImagePath(fileName)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") {
      throw error;
    }
  });
}
