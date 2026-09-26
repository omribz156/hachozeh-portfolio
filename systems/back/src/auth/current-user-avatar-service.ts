import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import sharp from "sharp";

import { deleteAvatar, putAvatar, readAvatar } from "./avatar-storage";

import type { Queryable } from "../db/client/pool";
import { resolvePublicDisplayName } from "../shared/public-user-identity";
import { parseObjectBody, parseRequiredStringField } from "../shared/zod-request-body";
import type { CurrentUserProfileResponse } from "./current-user-profile-service";

type AvatarImageKind = "png" | "jpg" | "webp" | "gif";

type AvatarImage = {
  buffer: Buffer;
};

type CurrentUserAvatarRow = {
  id: string;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  updated_at: Date;
};

export class CurrentUserAvatarServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "CurrentUserAvatarServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
const MAX_AVATAR_PIXELS = 16_777_216;
const AVATAR_QUARANTINE_DIR = resolve(process.cwd(), "workspace", "runtime", "uploads", "avatar-quarantine");
const AVATAR_PUBLIC_PREFIX = "/api/uploads/avatars/";
const AVATAR_OUTPUT_KIND = "webp";
const AVATAR_OUTPUT_CONTENT_TYPE = "image/webp";

function createAvatarRequestError(message: string): CurrentUserAvatarServiceError {
  return new CurrentUserAvatarServiceError(400, "invalid_request", message);
}

function createAvatarScanError(message: string): CurrentUserAvatarServiceError {
  return new CurrentUserAvatarServiceError(503, "avatar_scan_unavailable", message);
}

function mapAvatarRow(row: CurrentUserAvatarRow): CurrentUserProfileResponse {
  return {
    user: {
      userId: row.id,
      handle: row.handle,
      displayName: resolvePublicDisplayName(row.id, row.display_name, row.handle),
      bio: row.bio,
      avatarUrl: row.avatar_url,
      updatedAt: row.updated_at.toISOString()
    }
  };
}

function decodeBase64Image(dataUrl: string): AvatarImage {
  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    throw createAvatarRequestError("avatar image must be a base64 data URL.");
  }

  const rawKind = match[1].toLowerCase();
  const kind: AvatarImageKind = rawKind === "jpeg" ? "jpg" : (rawKind as AvatarImageKind);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");

  if (buffer.length === 0) {
    throw createAvatarRequestError("avatar image cannot be empty.");
  }

  if (buffer.length > MAX_AVATAR_BYTES) {
    throw createAvatarRequestError("avatar image must be 4MB or smaller.");
  }

  if (!matchesImageSignature(buffer, kind)) {
    throw createAvatarRequestError("avatar image bytes do not match the declared type.");
  }

  return { buffer };
}

function matchesImageSignature(buffer: Buffer, kind: AvatarImageKind): boolean {
  if (kind === "png") {
    return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  }

  if (kind === "jpg") {
    return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (kind === "webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }

  return buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
    buffer.subarray(0, 6).toString("ascii") === "GIF89a";
}

function createAvatarFileName(): string {
  return `avatar-${randomUUID()}.${AVATAR_OUTPUT_KIND}`;
}

function avatarFileNameFromUrl(avatarUrl: string | null): string | null {
  if (!avatarUrl?.startsWith(AVATAR_PUBLIC_PREFIX)) {
    return null;
  }

  const fileName = avatarUrl.slice(AVATAR_PUBLIC_PREFIX.length);
  if (!/^[a-zA-Z0-9_-]+\.webp$/.test(fileName)) {
    return null;
  }

  return fileName;
}

async function deleteOldLocalAvatar(avatarUrl: string | null, nextAvatarUrl?: string): Promise<void> {
  if (!avatarUrl || avatarUrl === nextAvatarUrl) {
    return;
  }

  const fileName = avatarFileNameFromUrl(avatarUrl);
  if (!fileName) {
    return;
  }

  await deleteAvatar(fileName);
}

export async function deleteLocalAvatarFileForUrl(avatarUrl: string | null): Promise<boolean> {
  const fileName = avatarFileNameFromUrl(avatarUrl);
  if (!fileName) {
    return false;
  }

  await deleteAvatar(fileName);

  return true;
}

export async function readLocalAvatarFile(fileName: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  if (!/^[a-zA-Z0-9_-]+\.webp$/.test(fileName)) {
    return null;
  }

  const buffer = await readAvatar(fileName);
  if (!buffer) {
    return null;
  }

  return {
    buffer,
    contentType: AVATAR_OUTPUT_CONTENT_TYPE
  };
}

function readScannerArgs(): string[] {
  const raw = process.env.AVATAR_MALWARE_SCANNER_ARGS || "";
  return raw.split(/\s+/).map((part) => part.trim()).filter(Boolean);
}

function runScanner(scanner: string, args: string[], filePath: string): Promise<void> {
  return new Promise((resolveScanner, rejectScanner) => {
    const child = spawn(scanner, [...args, filePath], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += String(chunk).slice(0, 2048);
    });

    child.on("error", rejectScanner);
    child.on("close", (code) => {
      if (code === 0) {
        resolveScanner();
        return;
      }

      rejectScanner(new CurrentUserAvatarServiceError(
        code === 1 ? 400 : 503,
        code === 1 ? "avatar_rejected" : "avatar_scan_failed",
        code === 1
          ? "avatar image failed security scanning."
          : `avatar security scan failed${stderr ? `: ${stderr}` : "."}`
      ));
    });
  });
}

async function scanQuarantinedAvatar(filePath: string): Promise<void> {
  const scanner = process.env.AVATAR_MALWARE_SCANNER?.trim();
  const requireScanner = process.env.AVATAR_REQUIRE_MALWARE_SCAN === "true";

  if (!scanner) {
    if (requireScanner) {
      throw createAvatarScanError("avatar malware scanner is required but not configured.");
    }
    return;
  }

  await runScanner(scanner, readScannerArgs(), filePath).catch((error) => {
    if (error instanceof CurrentUserAvatarServiceError) {
      throw error;
    }

    throw createAvatarScanError("avatar malware scanner could not be executed.");
  });
}

async function sanitizeAvatarImage(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_AVATAR_PIXELS
    });
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw createAvatarRequestError("avatar image dimensions could not be read.");
    }

    return await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_AVATAR_PIXELS
    })
      .rotate()
      .resize({
        width: 512,
        height: 512,
        fit: "cover",
        withoutEnlargement: true
      })
      .webp({ quality: 86 })
      .toBuffer();
  } catch (error) {
    if (error instanceof CurrentUserAvatarServiceError) {
      throw error;
    }

    throw createAvatarRequestError("avatar image could not be decoded safely.");
  }
}

async function secureAvatarImageForStorage(userId: string, image: AvatarImage): Promise<Buffer> {
  await mkdir(AVATAR_QUARANTINE_DIR, { recursive: true });
  const safeUserId = userId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) || "user";
  const quarantinePath = join(AVATAR_QUARANTINE_DIR, `${safeUserId}-${randomUUID()}.upload`);

  try {
    await writeFile(quarantinePath, image.buffer, { flag: "wx" });
    await scanQuarantinedAvatar(quarantinePath);
    return await sanitizeAvatarImage(image.buffer);
  } finally {
    await rm(quarantinePath, { force: true }).catch(() => undefined);
  }
}

export async function updateCurrentUserAvatar(
  db: Queryable,
  userId: string,
  body: unknown
): Promise<CurrentUserProfileResponse> {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createAvatarRequestError
  );
  const image = decodeBase64Image(parseRequiredStringField(parsed, "imageData", createAvatarRequestError));
  const current = await db.query<{ avatar_url: string | null }>(
    "select avatar_url from users where id = $1 and status = 'active'",
    [userId]
  );
  const oldAvatarUrl = current.rows[0]?.avatar_url ?? null;

  if (!current.rows[0]) {
    throw new CurrentUserAvatarServiceError(404, "user_not_found", "Current user was not found.");
  }

  const sanitizedImage = await secureAvatarImageForStorage(userId, image);
  const fileName = createAvatarFileName();
  const avatarUrl = `${AVATAR_PUBLIC_PREFIX}${fileName}`;

  await putAvatar(fileName, sanitizedImage);

  const result = await db.query<CurrentUserAvatarRow>(
    `
      update users
      set avatar_url = $2,
          updated_at = now()
      where id = $1
        and status = 'active'
      returning id, handle, display_name, bio, avatar_url, updated_at
    `,
    [userId, avatarUrl]
  );

  const row = result.rows[0];
  if (!row) {
    await deleteOldLocalAvatar(avatarUrl);
    throw new CurrentUserAvatarServiceError(404, "user_not_found", "Current user was not found.");
  }

  await deleteOldLocalAvatar(oldAvatarUrl, avatarUrl);
  return mapAvatarRow(row);
}

export async function clearCurrentUserAvatar(
  db: Queryable,
  userId: string
): Promise<CurrentUserProfileResponse> {
  const current = await db.query<{ avatar_url: string | null }>(
    "select avatar_url from users where id = $1 and status = 'active'",
    [userId]
  );
  const oldAvatarUrl = current.rows[0]?.avatar_url ?? null;

  const result = await db.query<CurrentUserAvatarRow>(
    `
      update users
      set avatar_url = null,
          updated_at = now()
      where id = $1
        and status = 'active'
      returning id, handle, display_name, bio, avatar_url, updated_at
    `,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    throw new CurrentUserAvatarServiceError(404, "user_not_found", "Current user was not found.");
  }

  await deleteOldLocalAvatar(oldAvatarUrl);
  return mapAvatarRow(row);
}
