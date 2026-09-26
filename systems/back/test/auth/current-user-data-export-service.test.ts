import { describe, expect, it, vi } from "vitest";

import type { Queryable } from "../../src/db/client/pool";
import { readCurrentUserDataExport } from "../../src/auth/current-user-data-export-service";

function createQueryable() {
  const query = vi.fn(async (sql: string, values?: unknown[]) => {
    expect(values).toEqual(["user_1"]);

    if (sql.includes("from users")) {
      return {
        rows: [
          {
            id: "user_1",
            handle: "user_abcd1234",
            status: "active",
            role: "user",
            trade_access_status: "enabled",
            display_name: null,
            bio: "builder",
            avatar_url: "/api/uploads/avatars/a.webp",
            created_at: new Date("2026-06-01T10:00:00.000Z"),
            updated_at: new Date("2026-06-13T10:00:00.000Z"),
            last_login_at: null
          }
        ]
      };
    }

    if (sql.includes("from user_identities")) {
      return {
        rows: [
          {
            type: "email",
            identifier_display: "omrib@navi.local",
            status: "active",
            verified_at: new Date("2026-06-01T10:00:00.000Z"),
            created_at: new Date("2026-06-01T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from user_social_links")) {
      return {
        rows: [
          {
            platform: "x",
            handle: "omrib",
            url: "https://x.com/omrib",
            verified_at: null,
            updated_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from accounts")) {
      return {
        rows: [
          {
            id: "acct_1",
            type: "user_cash",
            status: "active",
            balance_cached: "1000.000000",
            created_at: new Date("2026-06-01T10:00:00.000Z"),
            updated_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from contract_positions")) {
      return {
        rows: [
          {
            market_id: "market_1",
            market_title: "האם תל אביב תעבור 30 מעלות?",
            outcome_id: "outcome_yes",
            outcome_label: "כן",
            requested_outcome_id: "outcome_yes",
            requested_outcome_key: "yes",
            contract_side: "yes",
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            last_trade_at: null,
            settled_at: null,
            updated_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from positions")) {
      return {
        rows: [
          {
            market_id: "market_1",
            market_title: "האם תל אביב תעבור 30 מעלות?",
            outcome_id: "outcome_yes",
            outcome_label: "כן",
            shares: "10.000000",
            cost_basis: "5.000000",
            realized_pnl: "0.000000",
            last_trade_at: null,
            settled_at: null,
            updated_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from trades")) {
      return {
        rows: [
          {
            id: "trade_1",
            market_id: "market_1",
            market_title: "האם תל אביב תעבור 30 מעלות?",
            outcome_id: "outcome_yes",
            outcome_label: "כן",
            requested_outcome_key: "yes",
            contract_side: "yes",
            side: "buy",
            cash_amount: "5.000000",
            share_amount: "10.000000",
            avg_price: "0.50000000",
            price_before: "0.50000000",
            price_after: "0.51000000",
            created_at: new Date("2026-06-13T10:00:00.000Z")
          }
        ]
      };
    }

    if (sql.includes("from user_consents")) {
      return { rows: [] };
    }

    if (sql.includes("from notification_preferences")) {
      return { rows: [] };
    }

    if (sql.includes("from market_comments")) {
      return { rows: [] };
    }

    if (sql.includes("from feedback")) {
      return { rows: [] };
    }

    if (sql.includes("from community_discussions")) {
      return { rows: [] };
    }

    if (sql.includes("from user_follows f")) {
      return { rows: [] };
    }

    if (
      sql.includes("from user_follows where followed_user_id") ||
      sql.includes("from user_profile_views_daily")
    ) {
      return { rows: [{ count: "0" }] };
    }

    throw new Error(`Unexpected query: ${sql}`);
  });

  return { query } as Queryable;
}

describe("current user data export service", () => {
  it("builds a direct-download user data snapshot", async () => {
    const payload = await readCurrentUserDataExport(createQueryable(), "user_1");

    expect(payload.schema).toBe("hachozeh_user_data_export_v1");
    expect(payload.readable.title).toBe("ייצוא הנתונים שלי - החוזה");
    expect(payload.readable.summary).toEqual(expect.arrayContaining([
      { label: "כתובת פרופיל", value: "/@user_abcd1234" },
      { label: "פעולות מסחר", value: "1" }
    ]));
    expect(payload.readable.sections.find((section) => section.title === "פעולות מסחר")?.rows[0])
      .toMatchObject({
        "שוק": "האם תל אביב תעבור 30 מעלות?",
        "תוצאה": "כן",
        "סכום": "V₪ 5.00"
      });
    expect(payload.user?.displayName).toBe("חזאי ABCD1234");
    expect(payload.user?.handle).toBe("user_abcd1234");
    expect(payload.identities[0]?.identifier).toBe("omrib@navi.local");
    expect(payload.socialLinks[0]?.url).toBe("https://x.com/omrib");
    expect(payload.accounts[0]?.balance).toBe("1000.000000");
    expect(payload.positions[0]?.marketTitle).toBe("האם תל אביב תעבור 30 מעלות?");
    expect(payload.positions[0]?.shares).toBe("10.000000");
    expect(payload.contractPositions[0]?.contractSide).toBe("yes");
    expect(payload.trades[0]?.id).toBe("trade_1");
  });
});
