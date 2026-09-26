import { randomUUID } from "node:crypto";

import sharp from "sharp";

import type { Queryable } from "../db/client/pool";
import {
  parseNullableStringField,
  parseObjectBody,
  parseRequiredStringField
} from "../shared/zod-request-body";
import { deleteFeedbackImage, putFeedbackImage, readFeedbackImage } from "./feedback-image-storage";

// 'report' is created internally by the comment-report flow (market-comments-service), not the
// public feedback form, but it shares the feedback inbox so the operator sees reports in one place.
const FEEDBACK_TYPES = ["idea", "bug", "feedback", "report"] as const;
type FeedbackType = (typeof FEEDBACK_TYPES)[number];
type FeedbackImageKind = "png" | "jpg" | "webp" | "gif";

const MAX_FEEDBACK_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_FEEDBACK_IMAGE_PIXELS = 20_000_000;
const FEEDBACK_IMAGE_PUBLIC_PREFIX = "/api/uploads/feedback/";
const FEEDBACK_IMAGE_OUTPUT_CONTENT_TYPE = "image/webp";

type RecentFeedbackCountRow = {
  count: string;
};

type FeedbackInsertRow = {
  id: string;
  type: FeedbackType;
  screenshot_url: string | null;
  created_at: Date;
};

export type SubmitFeedbackResponse = {
  ok: true;
  feedback: {
    id: string;
    type: FeedbackType;
    status: "new";
    screenshotUrl: string | null;
    createdAt: string;
  };
};

export class FeedbackServiceError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.name = "FeedbackServiceError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function createFeedbackRequestError(message: string): FeedbackServiceError {
  return new FeedbackServiceError(400, "invalid_request", message);
}

function rejectControlChars(value: string, fieldName: string): void {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw createFeedbackRequestError(`${fieldName} cannot contain control characters.`);
  }
}

function normalizeType(value: string): FeedbackType {
  if ((FEEDBACK_TYPES as readonly string[]).includes(value)) {
    return value as FeedbackType;
  }

  throw createFeedbackRequestError("type must be idea, bug, or feedback.");
}

function normalizeTitle(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  rejectControlChars(normalized, "title");

  if (normalized.length > 120) {
    throw createFeedbackRequestError("title must be 120 characters or fewer.");
  }

  return normalized;
}

function normalizeMessage(value: string): string {
  const normalized = value.replace(/\r\n/g, "\n").trim();
  rejectControlChars(normalized, "message");

  if (normalized.length < 4) {
    throw createFeedbackRequestError("message must be at least 4 characters.");
  }

  if (normalized.length > 2000) {
    throw createFeedbackRequestError("message must be 2000 characters or fewer.");
  }

  return normalized;
}

function normalizeEmail(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  rejectControlChars(normalized, "email");

  if (normalized.length > 160) {
    throw createFeedbackRequestError("email must be 160 characters or fewer.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw createFeedbackRequestError("email must be a valid email address.");
  }

  return normalized;
}

function decodeBase64FeedbackImage(dataUrl: string | null): Buffer | null {
  if (!dataUrl) return null;

  const match = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,([a-zA-Z0-9+/=\s]+)$/);
  if (!match) {
    throw createFeedbackRequestError("imageData must be a base64 image data URL.");
  }

  const rawKind = match[1].toLowerCase();
  const kind: FeedbackImageKind = rawKind === "jpeg" ? "jpg" : (rawKind as FeedbackImageKind);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");

  if (buffer.length === 0) {
    throw createFeedbackRequestError("imageData cannot be empty.");
  }

  if (buffer.length > MAX_FEEDBACK_IMAGE_BYTES) {
    throw createFeedbackRequestError("imageData must be 4MB or smaller.");
  }

  if (!matchesImageSignature(buffer, kind)) {
    throw createFeedbackRequestError("imageData bytes do not match the declared type.");
  }

  return buffer;
}

function matchesImageSignature(buffer: Buffer, kind: FeedbackImageKind): boolean {
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

async function sanitizeFeedbackImage(input: Buffer): Promise<Buffer> {
  try {
    const image = sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_FEEDBACK_IMAGE_PIXELS
    });
    const metadata = await image.metadata();

    if (!metadata.width || !metadata.height) {
      throw createFeedbackRequestError("imageData dimensions could not be read.");
    }

    return await sharp(input, {
      failOn: "error",
      limitInputPixels: MAX_FEEDBACK_IMAGE_PIXELS
    })
      .rotate()
      .resize({
        width: 1600,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true
      })
      .webp({ quality: 82 })
      .toBuffer();
  } catch (error) {
    if (error instanceof FeedbackServiceError) {
      throw error;
    }

    throw createFeedbackRequestError("imageData could not be decoded safely.");
  }
}

function createFeedbackImageFileName(): string {
  return `feedback-${randomUUID()}.webp`;
}

function feedbackImageFileNameFromUrl(imageUrl: string | null): string | null {
  if (!imageUrl?.startsWith(FEEDBACK_IMAGE_PUBLIC_PREFIX)) {
    return null;
  }

  const fileName = imageUrl.slice(FEEDBACK_IMAGE_PUBLIC_PREFIX.length);
  if (!/^feedback-[a-zA-Z0-9_-]+\.webp$/.test(fileName)) {
    return null;
  }

  return fileName;
}

async function storeFeedbackImage(imageData: string | null): Promise<string | null> {
  const image = decodeBase64FeedbackImage(imageData);
  if (!image) return null;

  const fileName = createFeedbackImageFileName();
  await putFeedbackImage(fileName, await sanitizeFeedbackImage(image));
  return `${FEEDBACK_IMAGE_PUBLIC_PREFIX}${fileName}`;
}

async function deleteFeedbackImageByUrl(imageUrl: string | null): Promise<void> {
  const fileName = feedbackImageFileNameFromUrl(imageUrl);
  if (!fileName) return;

  await deleteFeedbackImage(fileName);
}

export async function readFeedbackImageFile(fileName: string): Promise<{
  buffer: Buffer;
  contentType: string;
} | null> {
  if (!/^feedback-[a-zA-Z0-9_-]+\.webp$/.test(fileName)) {
    return null;
  }

  const buffer = await readFeedbackImage(fileName);
  if (!buffer) {
    return null;
  }

  return {
    buffer,
    contentType: FEEDBACK_IMAGE_OUTPUT_CONTENT_TYPE
  };
}

async function assertFeedbackUserRateLimit(db: Queryable, userId: string): Promise<void> {
  const result = await db.query<RecentFeedbackCountRow>(
    `
      select count(*)::text as count
      from feedback
      where user_id = $1
        and created_at > now() - interval '1 hour'
    `,
    [userId]
  );

  const count = Number.parseInt(result.rows[0]?.count ?? "0", 10);
  if (Number.isFinite(count) && count >= 10) {
    throw new FeedbackServiceError(
      429,
      "rate_limited",
      "Too many feedback submissions. Please try again later."
    );
  }
}

export async function submitFeedback(
  db: Queryable,
  userId: string,
  body: unknown
): Promise<SubmitFeedbackResponse> {
  const parsed = parseObjectBody(
    body,
    "Request body must be a JSON object.",
    createFeedbackRequestError
  );

  const type = normalizeType(parseRequiredStringField(parsed, "type", createFeedbackRequestError));
  const message = normalizeMessage(
    parseRequiredStringField(parsed, "message", createFeedbackRequestError)
  );
  const title = normalizeTitle(parseNullableStringField(parsed, "title", createFeedbackRequestError));
  const replyEmail = normalizeEmail(
    parseNullableStringField(parsed, "email", createFeedbackRequestError)
  );
  const imageData = parseNullableStringField(parsed, "imageData", createFeedbackRequestError);

  await assertFeedbackUserRateLimit(db, userId);

  const feedbackId = `feedback_${randomUUID()}`;
  const screenshotUrl = await storeFeedbackImage(imageData);
  let result: { rows: FeedbackInsertRow[] };
  try {
    result = await db.query<FeedbackInsertRow>(
      `
        insert into feedback (
          id,
          user_id,
          type,
          title,
          message,
          reply_email,
          screenshot_url,
          status,
          created_at,
          updated_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, 'new', now(), now())
        returning id, type, screenshot_url, created_at
      `,
      [feedbackId, userId, type, title, message, replyEmail, screenshotUrl]
    );
  } catch (error) {
    await deleteFeedbackImageByUrl(screenshotUrl);
    throw error;
  }

  const row = result.rows[0];

  return {
    ok: true,
    feedback: {
      id: row?.id ?? feedbackId,
      type: row?.type ?? type,
      status: "new",
      screenshotUrl: row?.screenshot_url ?? screenshotUrl,
      createdAt: (row?.created_at ?? new Date()).toISOString()
    }
  };
}
