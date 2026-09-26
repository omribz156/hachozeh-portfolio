import { readFile } from "node:fs/promises";
import path from "node:path";

export type OracleLifecycleWorkerStatusRead = {
  objectType: "oracle_lifecycle_worker_status_read";
  generatedAt: string;
  runtimeDir: string;
  statusFile: string;
  statusFileExists: boolean;
  workerStatus: Record<string, unknown> | null;
  parseError?: string;
};

type ReadOracleLifecycleWorkerStatusOptions = {
  runtimeDir?: string;
  now?: Date;
  readText?: (filePath: string) => Promise<string>;
};

function resolveRepoRoot(): string {
  const cwd = process.cwd();
  const parent = path.basename(path.dirname(cwd));

  if (parent === "systems" && (path.basename(cwd) === "back" || path.basename(cwd) === "oracle")) {
    return path.resolve(cwd, "../..");
  }

  return cwd;
}

function resolveRuntimeDir(input?: string): string {
  return path.resolve(
    input?.trim() ||
      process.env.ORACLE_LIFECYCLE_WORKER_DIR?.trim() ||
      path.join(resolveRepoRoot(), "workspace/runtime/oracle-lifecycle-worker")
  );
}

export async function readOracleLifecycleWorkerStatus(
  options: ReadOracleLifecycleWorkerStatusOptions = {}
): Promise<OracleLifecycleWorkerStatusRead> {
  const runtimeDir = resolveRuntimeDir(options.runtimeDir);
  const statusFile = path.join(runtimeDir, "worker-status.json");
  const readText = options.readText ?? ((filePath: string) => readFile(filePath, "utf8"));
  const generatedAt = (options.now ?? new Date()).toISOString();

  try {
    const raw = await readText(statusFile);
    const parsed = JSON.parse(raw);

    return {
      objectType: "oracle_lifecycle_worker_status_read",
      generatedAt,
      runtimeDir,
      statusFile,
      statusFileExists: true,
      workerStatus:
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : { value: parsed }
    };
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === "ENOENT"
    ) {
      return {
        objectType: "oracle_lifecycle_worker_status_read",
        generatedAt,
        runtimeDir,
        statusFile,
        statusFileExists: false,
        workerStatus: null
      };
    }

    return {
      objectType: "oracle_lifecycle_worker_status_read",
      generatedAt,
      runtimeDir,
      statusFile,
      statusFileExists: true,
      workerStatus: null,
      parseError: error instanceof Error ? error.message : String(error)
    };
  }
}
