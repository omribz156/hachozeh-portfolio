import { describe, expect, it } from "vitest";

import {
  buildSeerCreateNodeArgs,
  buildPlan,
  readBooleanOption,
  renderPlanHuman,
  requireMaterializationRecord,
  requireMarketEnvironment,
  resolveSeerCreateScriptPath,
  resolveSeedAmount,
  selectDrafts
} from "./scripts/agent-market";
import type { SeerMarketCreationDraftSnapshot } from "./lifecycle/management/seer-market-creation-service";

function draft(overrides: Partial<SeerMarketCreationDraftSnapshot["items"][number]> = {}): SeerMarketCreationDraftSnapshot["items"][number] {
  return {
    objectType: "market_creation_draft",
    creationDraftId: "mcd_test",
    reviewItemId: "review_test",
    candidateMarketId: "cm_test_market",
    category: "sports",
    categoryKey: "sports",
    title: "מי תנצח במשחק הבדיקה?",
    description: null,
    openAt: "2026-06-27T12:00:00.000Z",
    closeAt: "2026-06-27T17:00:00.000Z",
    resolutionSource: "Official source",
    resolutionRules: "Official final score decides the market.",
    contract: {
      objectType: "market_contract_v1",
      version: "1",
      measurementKind: "official_final",
      resultShape: "single_winner",
      oracleCapability: "supported_full_cycle",
      sourceIds: ["source_official"],
      rules: []
    },
    oracleSourcePolicy: null,
    liquidityB: "25000.000000",
    closeOnEventCompletion: false,
    eventCompletionCloseRequiresHumanApproval: false,
    outcomes: [
      {
        outcomeId: "home",
        label: "בית",
        shortLabel: null,
        description: null,
        colorKey: null
      },
      {
        outcomeId: "away",
        label: "חוץ",
        shortLabel: null,
        description: null,
        colorKey: null
      }
    ],
    idempotencyKey: "mcd_test",
    whyNow: "Test market",
    createdAt: "2026-06-27T12:00:00.000Z",
    ...overrides
  };
}

function snapshot(items = [draft()]): SeerMarketCreationDraftSnapshot {
  return {
    objectType: "market_creation_draft_snapshot",
    snapshotId: "mcds_test",
    generatedAt: "2026-06-27T12:01:00.000Z",
    itemCount: items.length,
    items
  };
}

describe("agent market CLI planning", () => {
  it("requires explicit prod or test market environment", () => {
    expect(requireMarketEnvironment("prod")).toBe("prod");
    expect(requireMarketEnvironment("test")).toBe("test");
    expect(() => requireMarketEnvironment(undefined)).toThrow("Missing required flag --market-environment prod|test.");
    expect(() => requireMarketEnvironment("dev")).toThrow("Missing required flag --market-environment prod|test.");
  });

  it("parses boolean options strictly", () => {
    expect(readBooleanOption(undefined, false)).toBe(false);
    expect(readBooleanOption("true", false)).toBe(true);
    expect(readBooleanOption(true, false)).toBe(true);
    expect(readBooleanOption("false", true)).toBe(false);
    expect(() => readBooleanOption("maybe", false)).toThrow("Boolean flags must be true or false.");
  });

  it("selects either one draft or all drafts", () => {
    const first = draft({ creationDraftId: "mcd_one", candidateMarketId: "cm_one" });
    const second = draft({ creationDraftId: "mcd_two", candidateMarketId: "cm_two" });
    const state = snapshot([first, second]);

    expect(selectDrafts(state, { all: false, draft: "mcd_two" })).toEqual([second]);
    expect(selectDrafts(state, { all: true })).toEqual([first, second]);
    expect(() => selectDrafts(state, { all: false })).toThrow("Missing required flag --draft");
    expect(() => selectDrafts(state, { all: false, draft: "missing" })).toThrow("No matching creation draft found");
  });

  it("builds a dry-run materialize then publish plan through seer-create", () => {
    const selected = draft({
      creationDraftId: "mcd_btc",
      candidateMarketId: "cm_btc_up",
      seedAmount: "1234.000000"
    });
    const plan = buildPlan([selected], {
      allowManualResolution: false,
      execute: false,
      forceMaterialize: false,
      marketEnvironment: "prod"
    });

    expect(plan.execute).toBe(false);
    expect(plan.marketEnvironment).toBe("prod");
    expect(plan.items).toEqual([
      expect.objectContaining({
        creationDraftId: "mcd_btc",
        expectedMarketId: "disc-cm-btc-up",
        oracleCapability: "supported_full_cycle",
        seedAmount: "1234.000000"
      })
    ]);
    expect(plan.commands).toEqual([
      "npm --prefix systems/back run seer-create -- materialize --draft mcd_btc --market-environment prod --json",
      "npm --prefix systems/back run seer-create -- publish --draft mcd_btc --market-environment prod --json"
    ]);
    expect(renderPlanHuman(plan)).toContain("mode: dry-run");
  });

  it("makes manual-resolution and forced rematerialization explicit in commands", () => {
    const selected = draft({ contract: { objectType: "market_contract_v1", version: "1", measurementKind: "official_final", resultShape: "single_winner", oracleCapability: "manual_resolution_required", sourceIds: ["source_official"], rules: [] } });
    const plan = buildPlan([selected], {
      allowManualResolution: true,
      execute: true,
      forceMaterialize: true,
      marketEnvironment: "test",
      seedAmount: "777.000000"
    });

    expect(plan.commands[0]).toContain("--force true");
    expect(plan.commands[1]).toContain("--allow-manual-resolution true");
    expect(plan.commands[1]).toContain("--seed-amount 777.000000");
    expect(plan.items[0]?.oracleCapability).toBe("manual_resolution_required");
  });

  it("places an embedded watch-plan install between materialize and publish", () => {
    const selected = draft({
      eventId: "evt-show",
      watchPlan: {
        id: "show_watch",
        target: "event",
        checkerKind: "show_official_keywords",
        enabled: true,
        timezone: "Asia/Jerusalem",
        sourceUrls: ["https://example.com/show"],
        entities: ["זוג א"],
        keywords: ["הודח"],
        runAt: ["2026-07-20T20:45:00.000Z"],
        intervalMinutes: null,
        nextRunAt: null,
        proximityChars: 180,
        note: null
      }
    });
    const plan = buildPlan([selected], {
      allowManualResolution: false,
      execute: false,
      forceMaterialize: false,
      marketEnvironment: "prod"
    });

    expect(plan.commands).toEqual([
      expect.stringContaining("materialize"),
      "install embedded market-watch plan show_watch",
      expect.stringContaining("publish")
    ]);
  });

  it("falls back to reserve floor when draft seed is absent", () => {
    expect(resolveSeedAmount(draft({ seedAmount: undefined }), undefined)).toBe("17328.679514");
    expect(resolveSeedAmount(draft(), "42.000000")).toBe("42.000000");
  });

  it("uses tsx only for source scripts and plain node for compiled scripts", () => {
    const sourceScript = resolveSeerCreateScriptPath("/repo/systems/back/src/scripts/agent-market.ts");
    const compiledScript = resolveSeerCreateScriptPath("/app/systems/back/dist/back/src/scripts/agent-market.js");

    expect(sourceScript.replaceAll("\\", "/").endsWith("/seer-create.ts")).toBe(true);
    expect(compiledScript.replaceAll("\\", "/").endsWith("/seer-create.js")).toBe(true);
    expect(buildSeerCreateNodeArgs(sourceScript, ["list"])).toEqual([
      "--import",
      "tsx",
      sourceScript,
      "list"
    ]);
    expect(buildSeerCreateNodeArgs(compiledScript, ["list"])).toEqual([
      compiledScript,
      "list"
    ]);
  });

  it("requires authoritative materialization targets before installing a watch", () => {
    expect(requireMaterializationRecord({
      objectType: "seer_market_creation_materialization",
      marketId: "disc-cm-show-v2",
      eventId: "evt-show"
    })).toMatchObject({
      marketId: "disc-cm-show-v2",
      eventId: "evt-show"
    });
    expect(() => requireMaterializationRecord({
      objectType: "seer_market_creation_materialization",
      marketId: "disc-cm-show-v2"
    })).toThrow("invalid materialization receipt");
  });
});
