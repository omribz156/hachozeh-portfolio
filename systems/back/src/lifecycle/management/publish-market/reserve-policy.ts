import { ceilMoneyDecimal, quantizeMoney, toDecimal } from "../../../shared/decimals";

export function calculateLmsrReserveFloor(input: {
  liquidityB: string;
  outcomeCount: number;
}): string {
  return quantizeMoney(
    ceilMoneyDecimal(toDecimal(input.liquidityB).mul(Math.log(input.outcomeCount)))
  );
}
