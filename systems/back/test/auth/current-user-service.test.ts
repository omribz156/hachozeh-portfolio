import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { readCurrentUser } from "../../src/auth/current-user-service";

function createQueryable(rows?: Array<{
  user_id: string;
  user_status: "active" | "locked" | "archived";
  user_role: "user" | "admin";
  trade_access_status: "enabled" | "blocked";
  lock_reason_code: string | null;
  locked_at: Date | null;
  created_at: Date;
  last_login_at: Date | null;
  handle: string;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  showcase_categories: string[];
  identity_type: "email" | "google" | null;
  identifier_display: string | null;
  verified_at: Date | null;
}>): Queryable {
  return {
    query: vi.fn(async (sql: string, values?: unknown[]) => {
      if (sql.includes("from users u")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: rows ?? []
        };
      }

      if (sql.includes("from realization_events")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: [{ successful_return_count: "7" }]
        };
      }

      if (sql.includes("from user_verification_tier_purchases")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: []
        };
      }

      if (sql.includes("from user_follows")) {
        expect(values).toEqual(["user_1"]);

        return {
          rows: [{ follower_count: 2, following_count: 3 }]
        };
      }

      if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
        return { rows: [], rowCount: 0 };
      }
      throw new Error(`Unexpected query: ${sql}`);
    })
  };
}

describe("current user service", () => {
  it("returns current-user truth with masked identity and capabilities", async () => {
    const payload = await readCurrentUser(
      createQueryable([
        {
          user_id: "user_1",
          user_status: "active",
          user_role: "admin",
          trade_access_status: "enabled",
          lock_reason_code: null,
          locked_at: null,
          created_at: new Date("2026-04-05T09:00:00.000Z"),
          last_login_at: new Date("2026-04-05T09:15:00.000Z"),
          handle: "owner",
          display_name: "Owner",
          bio: "Testing markets",
          avatar_url: null,
          showcase_categories: ["sports", "politics"],
          identity_type: "email",
          identifier_display: "owner@example.com",
          verified_at: new Date("2026-04-05T09:12:00.000Z")
        }
      ]),
      "user_1"
    );

    expect(payload).toEqual({
      user: {
        userId: "user_1",
        status: "active",
        role: "admin",
        tradeAccessStatus: "enabled",
        lockReasonCode: null,
        lockedAt: null,
        createdAt: "2026-04-05T09:00:00.000Z",
        lastLoginAt: "2026-04-05T09:15:00.000Z",
        handle: "owner",
        displayName: "Owner",
        bio: "Testing markets",
        avatarUrl: null,
        showcaseCategories: ["sports", "politics"]
      },
      identity: {
        primary: {
          channel: "email",
          identifierHint: "ow***@e***.com",
          email: "owner@example.com",
          verifiedAt: "2026-04-05T09:12:00.000Z"
        }
      },
      capabilities: {
        canTrade: true,
        canAccessAdmin: true
      },
      reputation: {
        verification: {
          successfulReturns: 7,
          currentTier: null,
          purchasedTiers: [],
          tiers: [
            {
              tier: "gray",
              minSuccessfulReturns: 10,
              price: "5000.000000",
              label: "תג אפור",
              badgeLabel: "אפור"
            },
            {
              tier: "gold",
              minSuccessfulReturns: 20,
              price: "5000.000000",
              label: "תג זהב",
              badgeLabel: "זהב"
            },
            {
              tier: "diamond",
              minSuccessfulReturns: 50,
              price: "10000.000000",
              label: "תג יהלום",
              badgeLabel: "יהלום"
            }
          ],
          nextPurchase: {
            tier: "gray",
            label: "תג אפור",
            price: "5000.000000",
            minSuccessfulReturns: 10,
            progressSuccessfulReturns: 7,
            requiredSuccessfulReturns: 10,
            eligible: false,
            missingSuccessfulReturns: 3
          }
        }
      },
      social: {
        followerCount: 2,
        followingCount: 3
      }
    });
  });

  it("turns off trading capability when trade access is blocked", async () => {
    const payload = await readCurrentUser(
      createQueryable([
        {
          user_id: "user_1",
          user_status: "active",
          user_role: "user",
          trade_access_status: "blocked",
          lock_reason_code: "risk_review",
          locked_at: null,
          created_at: new Date("2026-04-05T09:00:00.000Z"),
          last_login_at: null,
          handle: "user_1",
          display_name: null,
          bio: null,
          avatar_url: null,
          showcase_categories: [],
          identity_type: "email",
          identifier_display: "user@example.com",
          verified_at: new Date("2026-04-05T09:12:00.000Z")
        }
      ]),
      "user_1"
    );

    expect(payload.capabilities).toEqual({
      canTrade: false,
      canAccessAdmin: false
    });
    expect(payload.user).toMatchObject({
      tradeAccessStatus: "blocked",
      lockReasonCode: "risk_review",
      lockedAt: null,
      displayName: "חזאי 79B0AA00"
    });
  });
});
