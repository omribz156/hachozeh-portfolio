import Decimal from "decimal.js";

export const EngineDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -100,
  toExpPos: 100
});

export const MONEY_SCALE = 6;
export const SHARES_SCALE = 6;
export const PRICE_SCALE = 8;
export const INTERNAL_SCALE = 18;
export const MATERIAL_SHARES_THRESHOLD = "0.010000";

const DECIMAL_STRING_PATTERN = /^-?\d+(?:\.\d+)?$/;

type ParseDecimalOptions = {
  allowNegative?: boolean;
  allowZero?: boolean;
  maxScale?: number;
  fieldName?: string;
};

export class DecimalValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalValidationError";
  }
}

function countFractionDigits(value: string): number {
  const fraction = value.split(".")[1];
  return fraction ? fraction.length : 0;
}

function readFieldName(options: ParseDecimalOptions): string {
  return options.fieldName ?? "value";
}

export function toDecimal(value: Decimal.Value): Decimal {
  return new EngineDecimal(value);
}

export function parseDecimalString(
  value: string,
  options: ParseDecimalOptions = {}
): Decimal {
  const fieldName = readFieldName(options);

  if (!DECIMAL_STRING_PATTERN.test(value)) {
    throw new DecimalValidationError(
      `${fieldName} must be a plain decimal string without scientific notation`
    );
  }

  if (options.maxScale !== undefined && countFractionDigits(value) > options.maxScale) {
    throw new DecimalValidationError(
      `${fieldName} exceeds the allowed precision of ${options.maxScale} decimal places`
    );
  }

  const decimal = toDecimal(value);

  if (!options.allowNegative && decimal.isNegative()) {
    throw new DecimalValidationError(`${fieldName} must not be negative`);
  }

  if (!options.allowZero && decimal.isZero()) {
    throw new DecimalValidationError(`${fieldName} must be greater than zero`);
  }

  return decimal;
}

export function quantizeDecimal(
  value: Decimal.Value,
  scale: number,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): Decimal {
  return toDecimal(value).toDecimalPlaces(scale, rounding);
}

export function normalizeDecimal(
  value: Decimal.Value,
  scale: number,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): string {
  return quantizeDecimal(value, scale, rounding).toFixed(scale);
}

export function quantizeMoneyDecimal(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): Decimal {
  return quantizeDecimal(value, MONEY_SCALE, rounding);
}

export function quantizeSharesDecimal(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): Decimal {
  return quantizeDecimal(value, SHARES_SCALE, rounding);
}

export function quantizePriceDecimal(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): Decimal {
  return quantizeDecimal(value, PRICE_SCALE, rounding);
}

export function quantizeMoney(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): string {
  return normalizeDecimal(value, MONEY_SCALE, rounding);
}

export function quantizeShares(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): string {
  return normalizeDecimal(value, SHARES_SCALE, rounding);
}

export function quantizePrice(
  value: Decimal.Value,
  rounding: Decimal.Rounding = Decimal.ROUND_HALF_UP
): string {
  return normalizeDecimal(value, PRICE_SCALE, rounding);
}

export function floorMoneyDecimal(value: Decimal.Value): Decimal {
  return quantizeMoneyDecimal(value, Decimal.ROUND_DOWN);
}

export function ceilMoneyDecimal(value: Decimal.Value): Decimal {
  return quantizeMoneyDecimal(value, Decimal.ROUND_UP);
}

export function floorSharesDecimal(value: Decimal.Value): Decimal {
  return quantizeSharesDecimal(value, Decimal.ROUND_DOWN);
}

export function shareStep(): Decimal {
  return toDecimal(1).div(toDecimal(10).pow(SHARES_SCALE));
}

export function isMaterialShareAmount(value: Decimal.Value): boolean {
  return toDecimal(value).gte(MATERIAL_SHARES_THRESHOLD);
}
