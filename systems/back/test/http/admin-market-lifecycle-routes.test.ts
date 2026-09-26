import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const adminActor = {
  actorId: "user_admin_1",
  mode: "session" as const,
  sessionId: "session_admin_1",
  role: "admin" as const
};

vi.mock("../../src/auth/actor-resolver", async () => {
  const actual = await vi.importActual<typeof import("../../src/auth/actor-resolver")>(
    "../../src/auth/actor-resolver"
  );

  return {
    ...actual,
    resolveRequiredAdminActor: vi.fn(async () => adminActor)
  };
});

vi.mock("../../src/lifecycle/management/create-market-draft-service", () => {
  class CreateMarketDraftServiceError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    CreateMarketDraftServiceError,
    parseCreateMarketDraftRequest: vi.fn((body: unknown) => body),
    createMarketDraft: vi.fn(async (_pool, request: Record<string, unknown>, actor) => ({
      objectType: "admin_create_route_result",
      marketId: "market_created_1",
      status: "draft",
      title: request.title,
      actorId: actor.actorId
    }))
  };
});

vi.mock("../../src/lifecycle/management/publish-market-service", () => {
  class PublishMarketServiceError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    PublishMarketServiceError,
    parsePublishMarketRequest: vi.fn((body: unknown) => body),
    publishMarket: vi.fn(async (_pool, marketId: string, request: Record<string, unknown>, actor) => ({
      objectType: "admin_publish_route_result",
      marketId,
      status: "open",
      idempotencyKey: request.idempotencyKey,
      actorId: actor.actorId
    }))
  };
});

vi.mock("../../src/lifecycle/horizon/close-market-service", () => {
  class CloseMarketServiceError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    CloseMarketServiceError,
    parseCloseMarketRequest: vi.fn((body: unknown) => body),
    closeMarket: vi.fn(async (_pool, marketId: string, request: Record<string, unknown>, actor) => ({
      objectType: "admin_close_route_result",
      marketId,
      status: "closed",
      closedAt: "2026-05-27T10:00:00.000Z",
      triggerType: request.triggerType,
      auditEventId: "audit_close_1",
      actorId: actor.actorId
    }))
  };
});

vi.mock("../../../oracle/src/resolve-market-service", () => {
  class ResolveMarketServiceError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    ResolveMarketServiceError,
    parseResolveMarketRequest: vi.fn((body: unknown) => body),
    resolveMarket: vi.fn(async (_pool, marketId: string, request: Record<string, unknown>, actor) => ({
      objectType: "admin_resolve_route_result",
      marketId,
      status: "resolved",
      winningOutcomeId: request.winningOutcomeId,
      resolutionId: "resolution_1",
      resolvedAt: "2026-05-27T10:05:00.000Z",
      settlementStatus: "completed",
      auditEventId: "audit_resolve_1",
      actorId: actor.actorId
    }))
  };
});

vi.mock("../../src/lifecycle/management/void-market-service", () => {
  class VoidMarketServiceError extends Error {
    readonly statusCode: number;
    readonly code: string;

    constructor(statusCode: number, code: string, message: string) {
      super(message);
      this.statusCode = statusCode;
      this.code = code;
    }
  }

  return {
    VoidMarketServiceError,
    parseVoidMarketRequest: vi.fn((body: unknown) => body),
    voidMarket: vi.fn(async (_pool, marketId: string, request: Record<string, unknown>, actor) => ({
      objectType: "admin_void_route_result",
      marketId,
      status: "voided",
      voidReason: request.reasonCode,
      auditEventId: "audit_void_1",
      actorId: actor.actorId
    }))
  };
});

vi.mock("../../src/http/market-stream-broadcasts", () => ({
  broadcastMarketLifecycleEvent: vi.fn()
}));

import { resolveRequiredAdminActor } from "../../src/auth/actor-resolver";
import { createMarketDraft } from "../../src/lifecycle/management/create-market-draft-service";
import { publishMarket } from "../../src/lifecycle/management/publish-market-service";
import { closeMarket } from "../../src/lifecycle/horizon/close-market-service";
import { broadcastMarketLifecycleEvent } from "../../src/http/market-stream-broadcasts";
import { resolveMarket } from "../../../oracle/src/resolve-market-service";
import { voidMarket } from "../../src/lifecycle/management/void-market-service";
import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("admin market lifecycle routes", () => {
  it("routes admin market create to the draft service", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/markets`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        title: "Admin-created market",
        idempotencyKey: "create-route-1"
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      objectType: "admin_create_route_result",
      marketId: "market_created_1",
      status: "draft",
      actorId: adminActor.actorId
    });
    expect(resolveRequiredAdminActor).toHaveBeenCalledTimes(1);
    expect(createMarketDraft).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Admin-created market"
      }),
      adminActor
    );
  });

  it.each([
    {
      name: "empty",
      body: "",
      expectedMessage: "JSON body is required"
    },
    {
      name: "invalid",
      body: "{",
      expectedMessage: "JSON body is invalid"
    },
    {
      name: "too large",
      body: JSON.stringify({
        title: "x".repeat(33 * 1024)
      }),
      expectedMessage: "JSON body too large"
    }
  ])("returns the existing JSON envelope for $name admin market create bodies", async ({
    body,
    expectedMessage
  }) => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/markets`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "invalid_request",
        message: expectedMessage
      }
    });
  });

  it("routes admin market publish, close, resolve, and void to lifecycle services", async () => {
    const { baseUrl } = await startServer();

    const publishResponse = await fetch(`${baseUrl}/admin/markets/market_route_1/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        idempotencyKey: "publish-route-1"
      })
    });
    const closeResponse = await fetch(`${baseUrl}/admin/markets/market_route_1/close`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        triggerType: "scheduled_time",
        idempotencyKey: "close-route-1"
      })
    });
    const resolveResponse = await fetch(`${baseUrl}/admin/markets/market_route_1/resolve`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        winningOutcomeId: "outcome_yes",
        idempotencyKey: "resolve-route-1"
      })
    });
    const voidResponse = await fetch(`${baseUrl}/admin/markets/market_route_1/void`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        reasonCode: "fixture_cleanup",
        idempotencyKey: "void-route-1"
      })
    });

    expect(publishResponse.status).toBe(200);
    expect(await publishResponse.json()).toMatchObject({
      objectType: "admin_publish_route_result",
      marketId: "market_route_1",
      status: "open"
    });
    expect(closeResponse.status).toBe(200);
    expect(await closeResponse.json()).toMatchObject({
      objectType: "admin_close_route_result",
      marketId: "market_route_1",
      status: "closed"
    });
    expect(resolveResponse.status).toBe(200);
    expect(await resolveResponse.json()).toMatchObject({
      objectType: "admin_resolve_route_result",
      marketId: "market_route_1",
      status: "resolved"
    });
    expect(voidResponse.status).toBe(200);
    expect(await voidResponse.json()).toMatchObject({
      objectType: "admin_void_route_result",
      marketId: "market_route_1",
      status: "voided"
    });

    expect(publishMarket).toHaveBeenCalledWith(
      expect.anything(),
      "market_route_1",
      expect.objectContaining({ idempotencyKey: "publish-route-1" }),
      adminActor
    );
    expect(closeMarket).toHaveBeenCalledWith(
      expect.anything(),
      "market_route_1",
      expect.objectContaining({ idempotencyKey: "close-route-1" }),
      adminActor
    );
    expect(resolveMarket).toHaveBeenCalledWith(
      expect.anything(),
      "market_route_1",
      expect.objectContaining({ idempotencyKey: "resolve-route-1" }),
      adminActor
    );
    expect(voidMarket).toHaveBeenCalledWith(
      expect.anything(),
      "market_route_1",
      expect.objectContaining({ idempotencyKey: "void-route-1" }),
      adminActor
    );
    expect(broadcastMarketLifecycleEvent).toHaveBeenCalledTimes(4);
  });
});
