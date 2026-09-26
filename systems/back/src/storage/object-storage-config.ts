type EnvMap = Record<string, string | undefined>;

export type R2StorageConfig = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

type R2StorageKind = {
  label: string;
  bucketEnv: "R2_AVATAR_BUCKET" | "R2_FEEDBACK_BUCKET";
};

const COMMON_R2_ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY"
] as const;

function trim(value: string | undefined): string {
  return value?.trim() ?? "";
}

function isObjectStorageRequired(env: EnvMap): boolean {
  return (
    trim(env["OBJECT_STORAGE_REQUIRED"]) === "true" ||
    (trim(env["NODE_ENV"]) === "production" && trim(env["DEPLOY_PROVIDER"]) === "render")
  );
}

export function readR2StorageConfig(
  kind: R2StorageKind,
  env: EnvMap = process.env
): R2StorageConfig | null {
  const values = {
    R2_ACCOUNT_ID: trim(env["R2_ACCOUNT_ID"]),
    R2_ACCESS_KEY_ID: trim(env["R2_ACCESS_KEY_ID"]),
    R2_SECRET_ACCESS_KEY: trim(env["R2_SECRET_ACCESS_KEY"]),
    [kind.bucketEnv]: trim(env[kind.bucketEnv])
  };
  const missing = [...COMMON_R2_ENV_KEYS, kind.bucketEnv].filter((key) => !values[key]);
  const configuredCount = [...COMMON_R2_ENV_KEYS, kind.bucketEnv].length - missing.length;

  if (missing.length === 0) {
    return {
      accountId: values.R2_ACCOUNT_ID,
      accessKeyId: values.R2_ACCESS_KEY_ID,
      secretAccessKey: values.R2_SECRET_ACCESS_KEY,
      bucket: values[kind.bucketEnv]
    };
  }

  if (configuredCount > 0) {
    throw new Error(`${kind.label} R2 storage is partially configured; missing ${missing.join(", ")}.`);
  }

  if (isObjectStorageRequired(env)) {
    throw new Error(`${kind.label} R2 storage is required on production Render; missing ${missing.join(", ")}.`);
  }

  return null;
}

export function readAvatarR2Config(env: EnvMap = process.env): R2StorageConfig | null {
  return readR2StorageConfig({ label: "Avatar", bucketEnv: "R2_AVATAR_BUCKET" }, env);
}

export function readFeedbackR2Config(env: EnvMap = process.env): R2StorageConfig | null {
  return readR2StorageConfig({ label: "Feedback image", bucketEnv: "R2_FEEDBACK_BUCKET" }, env);
}

export function assertProductionObjectStorageConfigured(env: EnvMap = process.env): void {
  readAvatarR2Config(env);
  readFeedbackR2Config(env);
}
