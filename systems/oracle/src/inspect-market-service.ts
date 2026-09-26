import type { Pool } from "pg";

import { type Queryable, resolveCanonicalMarketKeyById } from "../../back/src/platform-surface/oracle";
import type { OracleInspectionResult } from "./contracts";
import { OracleInspectionError } from "./inspect-market-errors";
import { persistInspectionResult } from "./inspect-market-persistence";
import { readMarketContext } from "./inspect-market-read-model";
import { buildOracleInspectionResult } from "./inspect-market-result-builder";
import type {
  OracleInspectionOptions,
  OracleInspectionRequest
} from "./inspect-market-types";

export { OracleInspectionError } from "./inspect-market-errors";
export type {
  OracleInspectionOptions,
  OracleInspectionRequest
} from "./inspect-market-types";

function isPoolLike(db: Queryable | Pool): db is Pool {
  return typeof (db as Pool).connect === "function";
}

export async function inspectOracleMarket(
  db: Queryable | Pool,
  request: OracleInspectionRequest,
  options?: OracleInspectionOptions
): Promise<OracleInspectionResult> {
  const market = await readMarketContext(db, request.marketId);
  const result = buildOracleInspectionResult({
    market,
    request
  });

  if (options?.persistResult && isPoolLike(db)) {
    return await persistInspectionResult(db, result);
  }

  return result;
}

export function resolveMarketIdFromInput(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new OracleInspectionError("market is required.");
  }

  const canonicalMarketKey = resolveCanonicalMarketKeyById(trimmed);

  if (canonicalMarketKey) {
    return trimmed;
  }

  if (trimmed.startsWith("market_")) {
    return trimmed;
  }

  const knownMarketId = {
    "bank-israel-mar-18": "market_seed_1",
    "mar-18": "market_seed_1",
    "next-prime-minister": "market_seed_next_prime_minister"
  }[trimmed];

  return knownMarketId ?? trimmed;
}
