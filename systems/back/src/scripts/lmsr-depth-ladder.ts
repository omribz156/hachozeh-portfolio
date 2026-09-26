import {
  buildLmsrDepthLadder,
  listLiquidityDepthPresets,
  type DepthLadderAction,
  type DepthLadderRow
} from "../engine/pricing";

type Format = "markdown" | "json";
type Mode = "ladder" | "presets";

function readArg(name: string): string | null {
  const prefix = `--${name}=`;
  const match = process.argv.slice(2).find((arg) => arg.startsWith(prefix));

  return match ? match.slice(prefix.length) : null;
}

function readCsv(name: string, fallback: readonly string[]): string[] {
  const raw = readArg(name) ?? process.env[`DEPTH_${name.toUpperCase().replace(/-/g, "_")}`];

  if (!raw) {
    return [...fallback];
  }

  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function readAction(): DepthLadderAction {
  const raw = readArg("action") ?? process.env.DEPTH_ACTION ?? "buy_yes";

  if (raw === "buy_yes" || raw === "buy_no") {
    return raw;
  }

  throw new Error("action must be buy_yes or buy_no");
}

function readFormat(): Format {
  const raw = readArg("format") ?? process.env.DEPTH_FORMAT ?? "markdown";

  if (raw === "markdown" || raw === "json") {
    return raw;
  }

  throw new Error("format must be markdown or json");
}

function readMode(): Mode {
  const raw = readArg("mode") ?? process.env.DEPTH_MODE ?? "ladder";

  if (raw === "ladder" || raw === "presets") {
    return raw;
  }

  throw new Error("mode must be ladder or presets");
}

function readAnchorOutcomeIndex(): number {
  const raw = readArg("anchor-outcome-index") ?? process.env.DEPTH_ANCHOR_OUTCOME_INDEX ?? "0";
  const parsed = Number(raw);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("anchor-outcome-index must be a non-negative integer");
  }

  return parsed;
}

function renderMarkdown(rows: readonly DepthLadderRow[]): string {
  const header = [
    "| action | b | cash | before | after | delta pp | avg | shares | spent |",
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |"
  ];
  const body = rows.map((row) =>
    [
      row.action,
      row.liquidityB,
      row.cashAmount,
      row.priceBefore,
      row.priceAfter,
      row.priceImpactPercentPoints,
      row.averageExecutionPrice,
      row.sharesBought,
      row.cashSpent
    ].join(" | ")
  ).map((line) => `| ${line} |`);

  return [...header, ...body].join("\n");
}

async function main(): Promise<void> {
  if (readMode() === "presets") {
    const presets = listLiquidityDepthPresets();

    if (readFormat() === "json") {
      console.log(JSON.stringify({ presets }, null, 2));
      return;
    }

    console.log([
      "| class | recommended b | range | intended trade | use |",
      "| --- | ---: | ---: | ---: | --- |",
      ...presets.map((preset) =>
        `| ${preset.depthClass} | ${preset.liquidityB} | ${preset.range.min}..${preset.range.max} | ${preset.intendedTradeSize} | ${preset.useWhen} |`
      )
    ].join("\n"));
    return;
  }

  const rows = buildLmsrDepthLadder({
    action: readAction(),
    anchorOutcomeIndex: readAnchorOutcomeIndex(),
    liquidityBands: readCsv("liquidity-bands", [
      "700.00000000",
      "2500.00000000",
      "10000.00000000",
      "25000.00000000",
      "75000.00000000",
      "100000.00000000"
    ]),
    cashAmounts: readCsv("amounts", [
      "100.000000",
      "500.000000",
      "2000.000000",
      "10000.000000",
      "25000.000000"
    ]),
    probabilities: readCsv("probabilities", ["0.50000000", "0.50000000"])
  });

  if (readFormat() === "json") {
    console.log(JSON.stringify({ rows }, null, 2));
    return;
  }

  console.log(renderMarkdown(rows));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
