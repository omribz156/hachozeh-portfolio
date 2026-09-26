import type { LiquidityAuditResult } from "../engine/pricing";

export type RebaseRepairPlan = {
  targetLiquidityB: string;
  requiresOperatorApproval: true;
  dryRun: {
    command: string;
    args: string[];
  };
  execute: {
    command: string;
    args: string[];
    reason: string;
  };
  verify: {
    command: string;
    args: string[];
  };
};

export type LiquidityAuditSummary = {
  total: number;
  flagged: number;
  critical: number;
  warning: number;
  watch: number;
  ok: number;
  repairable: number;
  requiresOperatorApproval: boolean;
};

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@+-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildRebaseRepairPlan(result: LiquidityAuditResult): RebaseRepairPlan | null {
  if (!result.flags.includes("below_recommended")) {
    return null;
  }

  const reason = `operator-approved depth repair: ${result.marketId}`;
  const dryRunArgs = [
    "--prefix",
    "systems/back",
    "run",
    "depth:liquidity-rebase",
    "--",
    `--market=${result.marketId}`,
    `--target-b=${result.recommendedLiquidityB}`
  ];
  const executeArgs = [
    ...dryRunArgs,
    "--execute",
    `--reason=${reason}`
  ];
  const verifyArgs = [
    "--prefix",
    "systems/back",
    "run",
    "depth:liquidity-audit",
    "--",
    `--market=${result.marketId}`,
    "--require-clean"
  ];

  return {
    targetLiquidityB: result.recommendedLiquidityB,
    requiresOperatorApproval: true,
    dryRun: {
      command: `npm ${dryRunArgs.map(quoteShellArg).join(" ")}`,
      args: dryRunArgs
    },
    execute: {
      command: `npm ${executeArgs.map(quoteShellArg).join(" ")}`,
      args: executeArgs,
      reason
    },
    verify: {
      command: `npm ${verifyArgs.map(quoteShellArg).join(" ")}`,
      args: verifyArgs
    }
  };
}

function buildRebasePlanLines(result: LiquidityAuditResult): string[] {
  const plan = buildRebaseRepairPlan(result);

  if (!plan) {
    return [];
  }

  return [
    `dry-run: ${plan.dryRun.command}`,
    `execute: ${plan.execute.command}`,
    `verify: ${plan.verify.command}`
  ];
}

export function buildLiquidityAuditSummary(
  results: readonly LiquidityAuditResult[]
): LiquidityAuditSummary {
  const summary: LiquidityAuditSummary = {
    total: results.length,
    flagged: 0,
    critical: 0,
    warning: 0,
    watch: 0,
    ok: 0,
    repairable: 0,
    requiresOperatorApproval: false
  };

  for (const result of results) {
    summary[result.severity] += 1;

    if (result.flags.length > 0) {
      summary.flagged += 1;
    }

    if (buildRebaseRepairPlan(result)) {
      summary.repairable += 1;
    }
  }

  summary.requiresOperatorApproval = summary.repairable > 0;
  return summary;
}

export function hasLiquidityAuditBlockingFindings(
  results: readonly LiquidityAuditResult[]
): boolean {
  const summary = buildLiquidityAuditSummary(results);

  return summary.requiresOperatorApproval || summary.critical > 0 || summary.warning > 0;
}

export function buildLiquidityAuditJsonPayload(
  results: readonly LiquidityAuditResult[],
  options: { withRebasePlan: boolean }
) {
  const summary = buildLiquidityAuditSummary(results);

  if (!options.withRebasePlan) {
    return { summary, results };
  }

  return {
    summary,
    results: results.map((result) => ({
      ...result,
      rebasePlan: buildRebaseRepairPlan(result)
    }))
  };
}

export function renderLiquidityAuditMarkdown(
  results: readonly LiquidityAuditResult[],
  options: { withRebasePlan: boolean }
): string {
  const summary = buildLiquidityAuditSummary(results);
  const lines = [
    `Summary: ${summary.flagged}/${summary.total} flagged · critical=${summary.critical} · warning=${summary.warning} · watch=${summary.watch} · ok=${summary.ok} · repairable=${summary.repairable}`,
    hasLiquidityAuditBlockingFindings(results)
      ? "Verdict: operator approval required before live liquidity rebase."
      : summary.watch > 0
        ? "Verdict: no liquidity repair required; watch flags remain."
      : "Verdict: clean for current filter.",
    "",
    "| severity | market | status | b | recommended | ratio | trades | volume/depth | flags |",
    "| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ...results.map((result) =>
      [
        result.severity,
        result.marketId,
        result.status,
        result.liquidityB,
        `${result.recommendedDepthClass} / ${result.recommendedLiquidityB}`,
        result.liquidityRatio,
        result.tradeCount,
        result.volumeToDepthRatio,
        result.flags.length ? result.flags.join(", ") : "-"
      ].join(" | ")
    ).map((line) => `| ${line} |`)
  ];

  if (options.withRebasePlan) {
    const repairLines = results.flatMap((result) => {
      const commands = buildRebasePlanLines(result);

      if (!commands.length) {
        return [];
      }

      return [
        "",
        `### ${result.marketId}`,
        "",
        ...commands.map((command) => `- ${command}`)
      ];
    });

    if (repairLines.length) {
      lines.push("", "## Rebase repair plan", ...repairLines);
    }
  }

  return lines.join("\n");
}
