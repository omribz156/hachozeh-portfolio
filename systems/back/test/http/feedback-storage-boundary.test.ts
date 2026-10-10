import { describe, expect, it } from "vitest";
import { deleteFeedbackImage, putFeedbackImage, readFeedbackImage } from "../../src/feedback/feedback-image-storage";

describe("feedback storage filename boundary", () => {
  it.each(["../.env", "/tmp/test.webp", "feedback-../../secret.webp", "feedback-a.webp\n", "feedback-" + "a".repeat(200) + ".webp"])("rejects %s before storage access", async (name) => {
    await expect(readFeedbackImage(name)).rejects.toThrow("Invalid feedback image filename");
    await expect(deleteFeedbackImage(name)).rejects.toThrow("Invalid feedback image filename");
    await expect(putFeedbackImage(name, Buffer.from("synthetic"))).rejects.toThrow("Invalid feedback image filename");
  });
});
