import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Pool } from "pg";

import type { RequestActor } from "../../../src/auth/actor-resolver";
import {
  buildCreateMarketDraftRequestFromSeerDraft,
  buildSeerMarketId,
  materializeSeerMarketCreationDraft,
  parseSeerMarketCreationDraftSnapshot,
  resolveNextSeerMarketId,
  resolveSeerDraftLiquidityB,
  type SeerMarketCreationDraft
} from "../../../src/lifecycle/management/seer-market-creation-service";
import { createMarketDraft } from "../../../src/lifecycle/management/create-market-draft-service";

vi.mock("../../../src/lifecycle/management/create-market-draft-service", async () => {
  const actual = await vi.importActual<typeof import("../../../src/lifecycle/management/create-market-draft-service")>(
    "../../../src/lifecycle/management/create-market-draft-service"
  );

  return {
    ...actual,
    createMarketDraft: vi.fn()
  };
});

const createMarketDraftMock = vi.mocked(createMarketDraft);

const SEER_ACTOR: RequestActor = {
  actorId: "system_seer",
  mode: "session",
  sessionId: "system_seer",
  role: "admin"
};

function fixtureDraft(): SeerMarketCreationDraft {
  return {
    objectType: "market_creation_draft",
    creationDraftId: "mcd_boi_apr",
    reviewItemId: "rh_boi_apr",
    candidateMarketId: "cm_boi_apr_followup",
    eventId: "event-boi-apr",
    eventSlug: "boi-april-rate-decision-2026",
    eventTitle: "Bank of Israel April decision",
    eventResolutionPolicy: "independent_children",
    eventChildLabel: "April decision",
    intakeLane: "planned-event",
    recurringTemplateId: "boi-rate-decision-v1",
    category: "economy",
    categoryKey: "economics",
    title: "Bank of Israel decision in April?",
    description: "Planned-event BOI follow-up.",
    openAt: "2026-04-15T08:00:00.000Z",
    closeAt: "2026-04-28T00:00:00.000Z",
    resolutionSource: "Bank of Israel official rate announcement.",
    resolutionRules: "Official BOI rate announcement decides the winning bucket.",
    contract: {
      objectType: "market_contract_v1",
      version: "seer-contract-v1",
      measurement: "Bank of Israel April rate decision.",
      delayPolicy: "If delayed, keep the market pending until the official announcement lands."
    },
    oracleSourcePolicy: {
      preferredSourceIds: ["src_boi_announcements"],
      contextSourceIds: ["src_google_trends_israel_interest_rate"],
      resolutionSourceIds: ["src_boi_announcements"],
      requiresHumanReviewOnSourceConflict: true
    },
    liquidityB: "1000.00000000",
    closeOnEventCompletion: true,
    eventCompletionCloseRequiresHumanApproval: true,
    outcomes: [
      {
        outcomeId: null,
        label: "25 bps decrease",
        shortLabel: null,
        description: null,
        colorKey: null
      },
      {
        outcomeId: null,
        label: "No change",
        shortLabel: null,
        description: null,
        colorKey: null
      }
    ],
    idempotencyKey: "seer-create:cm_boi_apr_followup:2026-04-15T08:00:00.000Z",
    whyNow: "BOI meeting ahead.",
    createdAt: "2026-04-15T08:00:00.000Z"
  };
}

describe("parseSeerMarketCreationDraftSnapshot", () => {
  it("normalizes valid snapshots", () => {
    const parsed = parseSeerMarketCreationDraftSnapshot({
      objectType: "market_creation_draft_snapshot",
      snapshotId: "mcds_1",
      generatedAt: "2026-04-15T08:00:00.000Z",
      itemCount: 1,
      items: [fixtureDraft()]
    });

    expect(parsed.items).toHaveLength(1);
    expect(parsed.items[0]?.candidateMarketId).toBe("cm_boi_apr_followup");
  });

  it("normalizes an embedded watch plan for publish-before-open installation", () => {
    const parsed = parseSeerMarketCreationDraftSnapshot({
      objectType: "market_creation_draft_snapshot",
      snapshotId: "mcds_watch",
      generatedAt: "2026-07-16T18:00:00.000Z",
      itemCount: 1,
      items: [{
        ...fixtureDraft(),
        watchPlan: {
          id: "show_watch",
          target: "event",
          checkerKind: "show_official_keywords",
          sourceUrls: ["https://example.com/show"],
          entities: ["זוג א"],
          keywords: ["הודח"],
          runAt: ["2026-07-20T20:45:00.000Z"],
          proximityChars: 180
        }
      }]
    });

    expect(parsed.items[0]?.watchPlan).toMatchObject({
      id: "show_watch",
      target: "event",
      enabled: true,
      timezone: "Asia/Jerusalem",
      proximityChars: 180
    });
  });
});

describe("buildCreateMarketDraftRequestFromSeerDraft", () => {
  it("maps seer drafts into backend create requests", () => {
    const request = buildCreateMarketDraftRequestFromSeerDraft(fixtureDraft());

    expect(request).toMatchObject({
      marketId: "disc-cm-boi-apr-followup",
      familyKey: "boi-rate-decision-v1",
      eventId: "event-boi-apr",
      eventSlug: "boi-april-rate-decision-2026",
      eventTitle: "Bank of Israel April decision",
      eventResolutionPolicy: "independent_children",
      eventChildLabel: "April decision",
      title: "Bank of Israel decision in April?",
      categoryKey: "economics",
      marketEnvironment: "prod",
      resolutionSource: "Bank of Israel official rate announcement.",
      liquidityB: "1000.00000000",
      marketContract: expect.objectContaining({
        objectType: "market_contract_v1",
        delayPolicy: "If delayed, keep the market pending until the official announcement lands."
      })
    });
    expect(request.outcomes).toHaveLength(2);
  });

  it("lets operator-created gauntlet drafts override the environment to test", () => {
    const request = buildCreateMarketDraftRequestFromSeerDraft(fixtureDraft(), undefined, {
      marketEnvironment: "test"
    });

    expect(request.marketEnvironment).toBe("test");
  });
});

describe("resolveSeerDraftLiquidityB", () => {
  it("honors the explicit Seer liquidity with no preset floor (binary ×1)", () => {
    expect(resolveSeerDraftLiquidityB(fixtureDraft())).toBe("1000.00000000");
  });

  it("preserves an explicitly deeper Seer draft", () => {
    expect(
      resolveSeerDraftLiquidityB({
        ...fixtureDraft(),
        liquidityB: "150000.00000000"
      })
    ).toBe("150000.00000000");
  });
});

describe("buildSeerMarketId", () => {
  it("adds version suffixes only after v1", () => {
    expect(buildSeerMarketId("cm_boi_apr_followup")).toBe("disc-cm-boi-apr-followup");
    expect(buildSeerMarketId("cm_boi_apr_followup", 2)).toBe("disc-cm-boi-apr-followup-v2");
  });
});

describe("resolveNextSeerMarketId", () => {
  it("returns v2 after only closed prior attempts exist", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 2,
      rows: [
        { id: "disc-cm-boi-apr-followup", status: "closed" },
        { id: "disc-cm-boi-apr-followup-v2", status: "resolved" }
      ]
    });

    const nextId = await resolveNextSeerMarketId({ query } as unknown as Pool, "cm_boi_apr_followup");

    expect(nextId).toBe("disc-cm-boi-apr-followup-v3");
  });

  it("reuses the active draft/open id when one exists", async () => {
    const query = vi.fn().mockResolvedValue({
      rowCount: 2,
      rows: [
        { id: "disc-cm-boi-apr-followup", status: "closed" },
        { id: "disc-cm-boi-apr-followup-v2", status: "draft" }
      ]
    });

    const nextId = await resolveNextSeerMarketId({ query } as unknown as Pool, "cm_boi_apr_followup");

    expect(nextId).toBe("disc-cm-boi-apr-followup-v2");
  });
});

describe("materializeSeerMarketCreationDraft", () => {
  beforeEach(() => {
    createMarketDraftMock.mockReset();
  });

  it("creates backend draft markets from seer creation drafts", async () => {
    createMarketDraftMock.mockResolvedValue({
      marketId: "disc-cm-boi-apr-followup",
      eventId: "event-boi-apr",
      status: "draft",
      createdAt: "2026-04-15T08:01:00.000Z",
      openAt: "2026-04-15T08:00:00.000Z",
      closeAt: "2026-04-28T00:00:00.000Z",
      outcomeIds: ["a", "b"],
      auditEventId: "audit_1"
    });

    const result = await materializeSeerMarketCreationDraft(
      {
        query: vi.fn().mockResolvedValue({
          rowCount: 0,
          rows: []
        })
      } as unknown as Pool,
      fixtureDraft(),
      SEER_ACTOR
    );

    expect(createMarketDraftMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        marketId: "disc-cm-boi-apr-followup",
        familyKey: "boi-rate-decision-v1",
        eventId: "event-boi-apr",
        eventResolutionPolicy: "independent_children",
        eventChildLabel: "April decision",
        marketEnvironment: "prod",
        title: "Bank of Israel decision in April?",
        liquidityB: "1000.00000000",
        marketContract: expect.objectContaining({
          objectType: "market_contract_v1"
        })
      }),
      SEER_ACTOR
    );
    expect(result).toMatchObject({
      creationDraftId: "mcd_boi_apr",
      marketId: "disc-cm-boi-apr-followup",
      eventId: "event-boi-apr",
      status: "draft",
      auditEventId: "audit_1"
    });
  });
});
