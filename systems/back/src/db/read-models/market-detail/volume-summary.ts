import type { MarketDetailPassiveRecord } from "../../../http/routes/market-detail-fixtures";
import { toDecimal } from "../../../shared/decimals";
import { readExecutionLegs } from "../../../shared/execution-legs";
import { resolvePassiveOutcomeKey } from "./identity";
import { formatVolumeLabel, parseVolumeDecimal } from "./volume-format";
import type {
  MarketDetailRow,
  MarketPriceTradeRow
} from "./types";

export function buildVolumeSummary(
  rows: MarketDetailRow[],
  tradeRows: MarketPriceTradeRow[]
): {
  totalVolumeLabel: MarketDetailPassiveRecord["snapshot"]["volumeLabel"];
  outcomeVolumes: NonNullable<MarketDetailPassiveRecord["snapshot"]["outcomeVolumes"]>;
} {
  const outcomeKeys = rows.map((row) => resolvePassiveOutcomeKey(row.outcome_id));
  const outcomeVolumes = Object.fromEntries(
    outcomeKeys.map((outcomeKey) => [outcomeKey, toDecimal(0)])
  );
  let totalVolume = toDecimal(0);

  for (const tradeRow of tradeRows) {
    const cashAmount = parseVolumeDecimal(tradeRow.cash_amount);
    const executionLegs = readExecutionLegs(tradeRow.execution_legs);
    const volumeLegs = executionLegs.length
      ? executionLegs
      : [
          {
            outcome_id: tradeRow.outcome_id,
            share_amount: tradeRow.share_amount
          }
        ];
    const knownOutcomeKeys = volumeLegs
      .map((leg) => resolvePassiveOutcomeKey(leg.outcome_id))
      .filter((outcomeKey) => outcomeKeys.includes(outcomeKey));

    totalVolume = totalVolume.plus(cashAmount);

    if (!knownOutcomeKeys.length) {
      continue;
    }

    const allocatedCashAmount = cashAmount.div(knownOutcomeKeys.length);

    for (const outcomeKey of knownOutcomeKeys) {
      outcomeVolumes[outcomeKey] = outcomeVolumes[outcomeKey].plus(allocatedCashAmount);
    }
  }

  return {
    totalVolumeLabel: formatVolumeLabel(totalVolume),
    outcomeVolumes: Object.fromEntries(
      outcomeKeys.map((outcomeKey) => [
        outcomeKey,
        formatVolumeLabel(outcomeVolumes[outcomeKey] ?? toDecimal(0))
      ])
    )
  };
}
