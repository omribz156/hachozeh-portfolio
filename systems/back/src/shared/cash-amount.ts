import { DecimalValidationError, parseDecimalString, quantizeMoney } from "./decimals";

const MAX_CASH_INPUT_DECIMALS = 2;
const MAX_INTERNAL_MONEY_DECIMALS = 6;

function countMeaningfulFractionDigits(value: string): number {
  const fraction = value.split(".")[1] ?? "";
  return fraction.replace(/0+$/, "").length;
}

export function normalizeUserCashAmountInput(
  value: string,
  fieldName = "cashAmount"
): string {
  const parsed = parseDecimalString(value, {
    fieldName,
    allowNegative: false,
    allowZero: false,
    maxScale: MAX_INTERNAL_MONEY_DECIMALS
  });

  if (countMeaningfulFractionDigits(value) > MAX_CASH_INPUT_DECIMALS) {
    throw new DecimalValidationError(`${fieldName} must not exceed 2 decimal places`);
  }

  return quantizeMoney(parsed);
}
