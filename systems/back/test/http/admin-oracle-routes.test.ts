import { afterEach, describe, expect, it } from "vitest";

import {
  closeAppTestServers,
  startServer
} from "./app-test-harness";

afterEach(async () => {
  await closeAppTestServers();
});

async function adminSessionQuery(sql: string) {
  if (sql.includes("from sessions s")) {
    return {
      rows: [
        {
          session_id: "session_admin_1",
          user_id: "user_admin_1",
          session_status: "active",
          created_at: new Date(Date.now() - 3_600_000),
          expires_at: new Date(Date.now() + 60_000),
          user_status: "active",
          user_role: "admin"
        }
      ]
    };
  }

  if (sql.includes("update sessions")) {
    return {
      rows: []
    };
  }

  if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
    return { rows: [], rowCount: 0 };
  }
  throw new Error(`Unexpected db query in app test: ${sql}`);
}

describe("admin and Oracle routes", () => {
  it("requires a real session for admin close route", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/markets/market_seed_next_prime_minister/close`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("requires a real session for admin create route", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/markets`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({})
    });
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("requires a real session for admin Oracle review queue", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/oracle/review-queue`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it("requires a real session for admin Oracle alerts", async () => {
    const { baseUrl } = await startServer();

    const response = await fetch(`${baseUrl}/admin/oracle/alerts`);
    const payload = await response.json();

    expect(response.status).toBe(401);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Authentication is required."
      }
    });
  });

  it.each([
    [
      "/admin/oracle/review-queue?caseStatus=approved",
      "caseStatus must be one of: review_needed, recommended, no_action, all."
    ],
    [
      "/admin/oracle/review-queue?limit=abc",
      "limit must be a positive integer."
    ],
    [
      `/admin/oracle/review-queue?limit=${"9".repeat(400)}`,
      "limit must be a positive integer."
    ],
    [
      "/admin/oracle/alerts?reviewStaleHours=soon",
      "reviewStaleHours must be a positive number."
    ]
  ])("validates admin Oracle query params at the HTTP boundary for %s", async (path, message) => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(`${baseUrl}${path}`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "invalid_request",
        message
      }
    });
  });

  it("returns read-only Oracle lifecycle worker status for admins", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(`${baseUrl}/admin/oracle/lifecycle-worker/status`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      objectType: "oracle_lifecycle_worker_status_read"
    });
    expect(payload).toHaveProperty("statusFileExists");
    expect(payload).toHaveProperty("workerStatus");
  });

  it("returns read-only Oracle source capability checks for admins", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(
      `${baseUrl}/admin/oracle/capability-check?sourceId=src_credible_reporting_bundle&measurementKind=reported_claim&resultShape=yes_no`,
      {
        headers: {
          cookie: "navi_session=live"
        }
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      objectType: "oracle_source_capability_check",
      sourceId: "src_credible_reporting_bundle",
      measurementKind: "reported_claim",
      resultShape: "yes_no",
      status: "credible_reporting_supported"
    });
  });

  it("accepts capability-check query aliases for measurement and shape", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(
      `${baseUrl}/admin/oracle/capability-check?sourceId=src_credible_reporting_bundle&measurement=reported_claim&shape=multi_outcome`,
      {
        headers: {
          cookie: "navi_session=live"
        }
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      objectType: "oracle_source_capability_check",
      sourceId: "src_credible_reporting_bundle",
      measurementKind: "reported_claim",
      resultShape: "multi_outcome",
      status: "credible_reporting_supported"
    });
  });

  it("returns invalid_request when capability-check query params are missing", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(`${baseUrl}/admin/oracle/capability-check?sourceId=src_credible_reporting_bundle`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "invalid_request",
        message: "sourceId, measurementKind, and resultShape are required."
      }
    });
  });

  it("returns the Oracle case not-found envelope for missing case detail", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return adminSessionQuery(sql);
        }

        if (sql.includes("update sessions")) {
          return adminSessionQuery(sql);
        }

        if (sql.includes("from oracle_cases oc")) {
          expect(values).toEqual(["oracle_case_missing_1"]);
          return { rows: [] };
        }

        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/oracle/cases/oracle_case_missing_1`, {
      headers: {
        cookie: "navi_session=live"
      }
    });
    const payload = await response.json();

    expect(response.status).toBe(404);
    expect(payload).toEqual({
      error: {
        code: "oracle_case_not_found",
        message: "Oracle case not found: oracle_case_missing_1"
      }
    });
  });

  it("returns read-only Oracle family route audit summaries for admins", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(
      `${baseUrl}/admin/oracle/family-route-audit?sourceId=src_credible_reporting_bundle`,
      {
        headers: {
          cookie: "navi_session=live"
        }
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      objectType: "family_route_audit_result"
    });
    expect(payload.checkedRouteCount).toBeGreaterThanOrEqual(1);
  });

  it("returns backend market assist for Oracle operator forms", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string, values?: unknown[]) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: []
          };
        }

        if (sql.includes("from markets")) {
          expect(values).toEqual(["market_seed_next_prime_minister"]);

          return {
            rows: [
              {
                id: "market_seed_next_prime_minister",
                title: "מי יהיה ראש הממשלה הבא?",
                status: "resolved",
                resolution_source: "official_election_result",
                oracle_source_policy: {
                  closeConditionSourceIds: ["src_gov_il_news"],
                  resolutionSourceIds: ["src_gov_il_news"],
                  fallbackSourceIds: ["src_official_backup"],
                  requiresHumanReviewOnSourceConflict: true
                }
              }
            ]
          };
        }

        if (sql.includes("from market_outcomes")) {
          return {
            rows: [
              {
                id: "market_seed_next_prime_minister_outcome_option_a",
                label: "מועמד א'",
                short_label: "א'",
                is_winner: true
              },
              {
                id: "market_seed_next_prime_minister_outcome_option_b",
                label: "מועמד ב'",
                short_label: "ב'",
                is_winner: false
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(
      `${baseUrl}/admin/oracle/market-assist/next-prime-minister?caseType=resolution_check`,
      {
        headers: {
          cookie: "navi_session=live"
        }
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      objectType: "oracle_market_assist",
      marketId: "market_seed_next_prime_minister",
      canonicalMarketKey: "next-prime-minister",
      caseType: "resolution_check",
      requiresWinningOutcome: true,
      resolutionSource: "official_election_result",
      sourcePolicySummary: {
        configuredSourceCount: 2,
        closeConditionSourceCount: 1,
        resolutionSourceCount: 1,
        fallbackSourceCount: 1,
        requiresHumanReviewOnSourceConflict: true
      }
    });
    expect(payload.outcomes).toEqual([
      expect.objectContaining({
        outcomeId: "market_seed_next_prime_minister_outcome_option_a",
        outcomeKey: "option-a",
        shortLabel: "א'",
        isWinner: true
      }),
      expect.objectContaining({
        outcomeId: "market_seed_next_prime_minister_outcome_option_b",
        outcomeKey: "option-b",
        shortLabel: "ב'",
        isWinner: false
      })
    ]);
  });

  it("rejects invalid oracle market-assist case types", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(
      `${baseUrl}/admin/oracle/market-assist/next-prime-minister?caseType=bogus`,
      {
        headers: {
          cookie: "navi_session=live"
        }
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toEqual({
      code: "invalid_request",
      message: "caseType must be one of: close_condition_check, resolution_check."
    });
  });

  it("rejects invalid oracle candidate-intake case types", async () => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(`${baseUrl}/admin/oracle/intake-candidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live"
      },
      body: JSON.stringify({
        marketId: "market_seed_1",
        caseType: "close condition",
        candidateEvidence: {
          candidateEvidenceId: "oce_sig_bad_case_type",
          signalId: "sig_bad_case_type",
          sourceId: "src_boi_announcements",
          sourceLabel: "Bank of Israel announcements",
          sourceUrl: "https://www.boi.org.il/en/communication-and-publications/press-releases/",
          title: "Rate decision signal",
          summary: "Bad case type should be rejected before intake.",
          observedAt: "2026-04-12T10:00:00.000Z"
        }
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error).toEqual({
      code: "invalid_request",
      message: "caseType must be one of: close_condition_check, resolution_check."
    });
  });

  it("returns candidate intake domain errors instead of masking them as internal failures", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_admin_1",
                user_id: "user_admin_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "admin"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: []
          };
        }

        if (sql.includes("from markets")) {
          return {
            rows: [
              {
                id: "market_seed_1",
                status: "open",
                title: "Will Bank of Israel cut rates on March 18?",
                close_at: new Date("2026-03-18T18:00:00.000Z"),
                resolution_source: "official_rate_decision",
                resolution_rules: "Official Bank of Israel rate decision wins.",
                oracle_source_policy: {
                  preferredSourceIds: ["src_boi_announcements"],
                  resolutionSourceIds: ["src_boi_announcements"]
                }
              }
            ]
          };
        }

        if (sql.includes("from market_outcomes")) {
          return {
            rows: [
              {
                id: "market_seed_1_outcome_hold",
                label: "Hold",
                is_winner: null
              },
              {
                id: "market_seed_1_outcome_cut_025",
                label: "Cut 0.25",
                is_winner: null
              },
              {
                id: "market_seed_1_outcome_cut_050_plus",
                label: "Cut 0.50+",
                is_winner: null
              },
              {
                id: "market_seed_1_outcome_hike",
                label: "Hike",
                is_winner: null
              }
            ]
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(`${baseUrl}/admin/oracle/intake-candidate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live"
      },
      body: JSON.stringify({
        marketId: "market_seed_1",
        caseType: "resolution_check",
        winningOutcomeKey: "rate-cut",
        candidateEvidence: {
          candidateEvidenceId: "oce_sig_bad_1",
          signalId: "sig_bad_1",
          sourceId: "src_boi_announcements",
          sourceLabel: "Bank of Israel announcements",
          sourceUrl: "https://www.boi.org.il/en/communication-and-publications/press-releases/",
          title: "Rate decision signal",
          summary: "Shared-source candidate mapped to a bad outcome key.",
          observedAt: "2026-04-12T10:00:00.000Z",
          configuredRoles: ["resolution_preferred"],
          authorityProfile: "official",
          fetchReadiness: "planned",
          reviewReasons: ["Probe invalid key"]
        }
      })
    });
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload).toMatchObject({
      error: {
        code: "candidate_not_intakeable",
        message: "Winning outcome key does not belong to market: rate-cut"
      }
    });
  });

  it.each([
    "/admin/oracle/intake-candidate",
    "/admin/oracle/review-action",
    "/admin/oracle/approve-resolution-candidate"
  ])("returns the existing JSON body error envelope for %s", async (path) => {
    const { baseUrl } = await startServer({
      queryImpl: adminSessionQuery
    });

    const response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: "navi_session=live"
      },
      body: ""
    });
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toEqual({
      error: {
        code: "invalid_request",
        message: "JSON body is required"
      }
    });
  });

  it("rejects non-admin session on admin resolve route", async () => {
    const { baseUrl } = await startServer({
      queryImpl: async (sql: string) => {
        if (sql.includes("from sessions s")) {
          return {
            rows: [
              {
                session_id: "session_user_1",
                user_id: "user_1",
                session_status: "active",
                created_at: new Date(Date.now() - 3_600_000),
                expires_at: new Date(Date.now() + 60_000),
                user_status: "active",
                user_role: "user"
              }
            ]
          };
        }

        if (sql.includes("update sessions")) {
          return {
            rows: []
          };
        }

        if (sql.startsWith("set local statement_timeout") || sql.startsWith("set local lock_timeout")) {
          return { rows: [], rowCount: 0 };
        }
        throw new Error(`Unexpected db query in app test: ${sql}`);
      }
    });

    const response = await fetch(
      `${baseUrl}/admin/markets/market_seed_next_prime_minister/resolve`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: "navi_session=live"
        },
        body: JSON.stringify({})
      }
    );
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload).toMatchObject({
      error: {
        code: "unauthorized",
        message: "Admin access is required."
      }
    });
  });
});
