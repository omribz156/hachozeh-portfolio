import type Decimal from "decimal.js";

import { parseDecimalString } from "../shared/decimals";

export type SellOwnershipRow = {
  shares: string;
} | null | undefined;

export type SellOwnershipCheck =
  | {
      ok: true;
      ownedShares: Decimal;
    }
  | {
      ok: false;
      ownedShares: Decimal | null;
    };

export function checkSellOwnership(
  row: SellOwnershipRow,
  requestedShares: Decimal,
  fieldName = "ownedShares"
): SellOwnershipCheck {
  if (!row) {
    return {
      ok: false,
      ownedShares: null
    };
  }

  const ownedShares = parseDecimalString(row.shares, {
    fieldName,
    allowNegative: false,
    allowZero: false,
    maxScale: 6
  });

  if (requestedShares.gt(ownedShares)) {
    return {
      ok: false,
      ownedShares
    };
  }

  return {
    ok: true,
    ownedShares
  };
}
