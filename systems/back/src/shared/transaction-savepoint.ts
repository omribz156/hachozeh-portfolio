import type { Queryable } from "../db/client/pool";

const SAVEPOINT_NAME_RE = /^[a-z][a-z0-9_]{0,58}$/;

export type SavepointExecutionResult<T> =
  | {
      success: true;
      value: T;
    }
  | {
      success: false;
      error: unknown;
    };

function validateSavepointName(savepointName: string): string {
  if (!SAVEPOINT_NAME_RE.test(savepointName)) {
    throw new Error(`Invalid savepoint name: ${savepointName}`);
  }

  return savepointName;
}

export async function withSavepoint<T>(
  db: Queryable,
  savepointName: string,
  callback: () => Promise<T>
): Promise<SavepointExecutionResult<T>> {
  const savepoint = validateSavepointName(savepointName);

  await db.query(`savepoint ${savepoint}`);

  try {
    const value = await callback();
    await db.query(`release savepoint ${savepoint}`);

    return {
      success: true,
      value
    };
  } catch (error) {
    try {
      await db.query(`rollback to savepoint ${savepoint}`);
      await db.query(`release savepoint ${savepoint}`);
    } catch (recoveryError) {
      throw recoveryError;
    }

    return {
      success: false,
      error
    };
  }
}
