import { describe, expect, it } from "vitest";

import {
  assertProductionObjectStorageConfigured,
  readAvatarR2Config,
  readFeedbackR2Config
} from "../../src/storage/object-storage-config";

describe("object storage config", () => {
  it("allows local fallback outside required object-storage environments", () => {
    expect(readAvatarR2Config({ NODE_ENV: "development" })).toBeNull();
    expect(readFeedbackR2Config({ NODE_ENV: "test" })).toBeNull();
  });

  it("fails closed for missing Render production R2 storage", () => {
    expect(() => assertProductionObjectStorageConfigured({
      NODE_ENV: "production",
      DEPLOY_PROVIDER: "render"
    })).toThrow("Avatar R2 storage is required on production Render");
  });

  it("rejects partial R2 config before falling back to disk", () => {
    expect(() => readAvatarR2Config({
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key"
    })).toThrow("Avatar R2 storage is partially configured");
  });

  it("reads separate avatar and feedback buckets", () => {
    const env = {
      R2_ACCOUNT_ID: "account",
      R2_ACCESS_KEY_ID: "key",
      R2_SECRET_ACCESS_KEY: "secret",
      R2_AVATAR_BUCKET: "assets",
      R2_FEEDBACK_BUCKET: "assets"
    };

    expect(readAvatarR2Config(env)).toMatchObject({ bucket: "assets" });
    expect(readFeedbackR2Config(env)).toMatchObject({ bucket: "assets" });
  });
});
