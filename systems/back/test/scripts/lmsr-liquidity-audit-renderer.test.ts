import { describe, expect, it } from "vitest";

import type { LiquidityAuditResult } from "../../src/engine/pricing";
import {
  buildLiquidityAuditJsonPayload,
  buildLiquidityAuditSummary,
  buildRebaseRepairPlan,
  hasLiquidityAuditBlockingFindings,
  renderLiquidityAuditMarkdown
} from "../../src/scripts/lmsr-liquidity-audit-renderer";

const CRITICAL_RESULT: LiquidityAuditResult = {
  marketId: "disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31",
  title: "האם שער הדולר היציג יהיה מעל 3.70 ₪ ב-31 במאי?",
  status: "open",
  categoryKey: "economics",
  familyKey: "lin-boi-rate-decisions",
  outcomeCount: 2,
  liquidityB: "700.00000000",
  tradeCount: 2216,
  tradeVolume: "27184216.348724",
  recommendedDepthClass: "serious_economy_politics",
  recommendedLiquidityB: "75000.00000000",
  recommendedMinLiquidityB: "25000.00000000",
  recommendedMaxLiquidityB: "75000.00000000",
  liquidityRatio: "0.0093",
  volumeToDepthRatio: "38834.5948",
  flags: [
    "below_recommended",
    "below_recommended_min",
    "legacy_shallow_pool",
    "volume_depth_mismatch"
  ],
  severity: "critical"
};

const OK_RESULT: LiquidityAuditResult = {
  ...CRITICAL_RESULT,
  marketId: "disc-cm-healthy",
  liquidityB: "75000.00000000",
  liquidityRatio: "1.0000",
  flags: [],
  severity: "ok"
};

const WATCH_RESULT: LiquidityAuditResult = {
  ...OK_RESULT,
  flags: ["volume_depth_mismatch"],
  severity: "watch"
};

describe("lmsr liquidity audit renderer", () => {
  it("builds an argv-safe operator-gated rebase plan", () => {
    const plan = buildRebaseRepairPlan(CRITICAL_RESULT);

    expect(plan).toMatchObject({
      targetLiquidityB: "75000.00000000",
      requiresOperatorApproval: true,
      dryRun: {
        args: [
          "--prefix",
          "systems/back",
          "run",
          "depth:liquidity-rebase",
          "--",
          "--market=disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31",
          "--target-b=75000.00000000"
        ]
      },
      execute: {
        reason: "operator-approved depth repair: disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31"
      },
      verify: {
        args: [
          "--prefix",
          "systems/back",
          "run",
          "depth:liquidity-audit",
          "--",
          "--market=disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31",
          "--require-clean"
        ]
      }
    });
    expect(plan?.execute.args).toContain("--execute");
    expect(plan?.execute.command).toContain("'--reason=operator-approved depth repair:");
    expect(plan?.verify.command).toContain("depth:liquidity-audit");
  });

  it("omits rebase plans for healthy rows", () => {
    expect(buildRebaseRepairPlan(OK_RESULT)).toBeNull();
  });

  it("adds structured rebase plans to json output only when requested", () => {
    const withoutPlan = buildLiquidityAuditJsonPayload([CRITICAL_RESULT], {
      withRebasePlan: false
    });
    const withPlan = buildLiquidityAuditJsonPayload([CRITICAL_RESULT], {
      withRebasePlan: true
    });

    expect(withoutPlan.results[0]).not.toHaveProperty("rebasePlan");
    expect(withPlan.results[0]).toMatchObject({
      rebasePlan: {
        targetLiquidityB: "75000.00000000",
        requiresOperatorApproval: true,
        verify: {
          command: "npm --prefix systems/back run depth:liquidity-audit -- --market=disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31 --require-clean"
        }
      }
    });
  });

  it("summarizes severity counts and operator approval state", () => {
    const summary = buildLiquidityAuditSummary([CRITICAL_RESULT, OK_RESULT]);

    expect(summary).toEqual({
      total: 2,
      flagged: 1,
      critical: 1,
      warning: 0,
      watch: 0,
      ok: 1,
      repairable: 1,
      requiresOperatorApproval: true
    });
  });

  it("does not block require-clean semantics for watch-only volume/depth rows", () => {
    expect(hasLiquidityAuditBlockingFindings([WATCH_RESULT])).toBe(false);

    const markdown = renderLiquidityAuditMarkdown([WATCH_RESULT], {
      withRebasePlan: true
    });

    expect(markdown).toContain("Summary: 1/1 flagged");
    expect(markdown).toContain("Verdict: no liquidity repair required; watch flags remain.");
  });

  it("renders markdown repair commands for flagged rows", () => {
    const markdown = renderLiquidityAuditMarkdown([CRITICAL_RESULT, OK_RESULT], {
      withRebasePlan: true
    });

    expect(markdown).toContain("Summary: 1/2 flagged");
    expect(markdown).toContain("Verdict: operator approval required before live liquidity rebase.");
    expect(markdown).toContain("## Rebase repair plan");
    expect(markdown).toContain("### disc-cm-front-sixpack-boi-usd-ils-3-70-2026-05-31");
    expect(markdown).toContain("depth:liquidity-rebase");
    expect(markdown).toContain("verify: npm --prefix systems/back run depth:liquidity-audit");
    expect(markdown).not.toContain("### disc-cm-healthy");
  });
});
