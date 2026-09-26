import { describe, expect, it, vi } from "vitest";

import sharp from "sharp";

import type { Queryable } from "../../src/db/client/pool";
import { submitFeedback } from "../../src/feedback/feedback-service";
import { putFeedbackImage } from "../../src/feedback/feedback-image-storage";

vi.mock("../../src/feedback/feedback-image-storage", () => ({
  deleteFeedbackImage: vi.fn(async () => undefined),
  putFeedbackImage: vi.fn(async () => undefined),
  readFeedbackImage: vi.fn(async () => null)
}));

function createQueryable(options?: {
  recentCount?: string;
  expectedScreenshotUrl?: RegExp | null;
}) {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    if (sql.includes("count(*)::text")) {
      expect(values).toEqual(["user_1"]);
      return {
        rows: [{ count: options?.recentCount ?? "0" }]
      };
    }

    if (sql.includes("insert into feedback")) {
      expect(values?.[1]).toBe("user_1");
      expect(values?.[2]).toBe("idea");
      expect(values?.[3]).toBe("Better charts");
      expect(values?.[4]).toBe("Please add a smoother graph.");
      expect(values?.[5]).toBe("omri@example.com");
      if (options?.expectedScreenshotUrl) {
        expect(values?.[6]).toEqual(expect.stringMatching(options.expectedScreenshotUrl));
      } else {
        expect(values?.[6]).toBeNull();
      }

      return {
        rows: [
          {
            id: "feedback_1",
            type: "idea",
            screenshot_url: values?.[6] ?? null,
            created_at: new Date("2026-06-14T10:00:00.000Z")
          }
        ]
      };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as Queryable;
}

describe("feedback service", () => {
  it("stores normalized feedback for the authenticated user", async () => {
    const payload = await submitFeedback(createQueryable(), "user_1", {
      type: "idea",
      title: " Better   charts ",
      message: " Please add a smoother graph. ",
      email: " Omri@Example.com "
    });

    expect(payload).toEqual({
      ok: true,
      feedback: {
        id: "feedback_1",
        type: "idea",
        status: "new",
        screenshotUrl: null,
        createdAt: "2026-06-14T10:00:00.000Z"
      }
    });
  });

  it("stores an optional sanitized feedback image URL", async () => {
    const sourceImage = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 255, g: 215, b: 0, alpha: 1 }
      }
    }).png().toBuffer();
    const payload = await submitFeedback(
      createQueryable({ expectedScreenshotUrl: /^\/api\/uploads\/feedback\/feedback-[a-zA-Z0-9_-]+\.webp$/ }),
      "user_1",
      {
        type: "idea",
        title: " Better   charts ",
        message: " Please add a smoother graph. ",
        email: " Omri@Example.com ",
        imageData: `data:image/png;base64,${sourceImage.toString("base64")}`
      }
    );

    expect(putFeedbackImage).toHaveBeenCalledWith(
      expect.stringMatching(/^feedback-[a-zA-Z0-9_-]+\.webp$/),
      expect.any(Buffer)
    );
    expect(payload.feedback.screenshotUrl).toEqual(
      expect.stringMatching(/^\/api\/uploads\/feedback\/feedback-[a-zA-Z0-9_-]+\.webp$/)
    );
  });

  it("rejects short messages", async () => {
    await expect(
      submitFeedback(createQueryable(), "user_1", {
        type: "bug",
        message: "no"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("rejects invalid reply email", async () => {
    await expect(
      submitFeedback(createQueryable(), "user_1", {
        type: "feedback",
        message: "message is long enough",
        email: "not-email"
      })
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "invalid_request"
    });
  });

  it("rate-limits noisy signed-in users before insert", async () => {
    await expect(
      submitFeedback(createQueryable({ recentCount: "10" }), "user_1", {
        type: "idea",
        message: "message is long enough"
      })
    ).rejects.toMatchObject({
      statusCode: 429,
      code: "rate_limited"
    });
  });
});
