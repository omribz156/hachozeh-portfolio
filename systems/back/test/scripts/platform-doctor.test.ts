import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  parseDoctorOptions,
  runPlatformDoctor
} from "../../src/scripts/platform-doctor";

function slashPath(value: string): string {
  return value.replaceAll("\\", "/");
}

describe("platform doctor", () => {
  it("builds default local URLs", () => {
    const options = parseDoctorOptions([]);

    expect(options.backendBaseUrl).toBe("http://127.0.0.1:3001");
    expect(options.frontendBaseUrl).toBe("http://127.0.0.1:6969");
    expect(options.frontendUrl).toContain("http://127.0.0.1:6969/");
    expect(options.production).toBe(false);
    expect(options.deep).toBe(false);
    expect(options.skipFrontend).toBe(false);
    expect(options.readLatencySamples).toBe(3);
    expect(options.readLatencyP95WatchMs).toBe(1000);
    expect(options.frontendElapsedWatchMs).toBe(0);
    expect(options.json).toBe(false);
    expect(options.report).toBe(false);
    expect(slashPath(options.reportPath)).toContain("workspace/runtime/doctor/");
  });

  it("uses Render diagnostics bearer token env as the operator auth fallback", () => {
    vi.stubEnv("DIAGNOSTICS_BEARER_TOKEN", "render-diagnostics-token");

    try {
      const options = parseDoctorOptions([]);

      expect(options.diagnosticsBearer).toBe("render-diagnostics-token");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("can skip frontend probes for backend-only checks", async () => {
    const options = parseDoctorOptions(["--backend-only"]);
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? { health: { verdict: "ok", warnings: [] } }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        ...options,
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("ok");
    expect(report.checks.map((check) => check.name)).toEqual([
      "backend_live",
      "backend_ready",
      "backend_diagnostics"
    ]);
    expect(fetchImpl).not.toHaveBeenCalledWith(
      "http://front.test/trending.html",
      expect.anything()
    );
  });

  it("builds production URLs from the public base URL", () => {
    const options = parseDoctorOptions(["--production", "--public-base-url=https://hachozeh.com"]);

    expect(options.production).toBe(true);
    expect(options.backendBaseUrl).toBe("https://hachozeh.com");
    expect(options.frontendBaseUrl).toBe("https://hachozeh.com");
    expect(options.frontendUrl).toBe("https://hachozeh.com");
    expect(options.horizonSchedulerRequired).toBe(true);
    expect(options.lifecycleHeartbeatRequired).toBe(true);
  });

  it("returns ok when backend, diagnostics, and frontend are healthy", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? { health: { verdict: "ok", warnings: [] } }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("ok");
    expect(report.notes).toEqual(["all_checks_ok"]);
    expect(report.checks.map((check) => check.name)).toEqual([
      "backend_live",
      "backend_ready",
      "backend_diagnostics",
      "frontend_ready",
      "frontend_portfolio",
      "frontend_settings",
      "frontend_breaking",
      "frontend_topic"
    ]);
  });

  it("returns watch when frontend probes are slow but reachable", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.startsWith("http://front.test")) {
        await new Promise((resolve) => setTimeout(resolve, 5));
      }

      const payload = target.includes("/health/diagnostics")
        ? { health: { verdict: "ok", warnings: [] } }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100,
        frontendElapsedWatchMs: 1
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.checks.find((check) => check.name === "frontend_ready")).toMatchObject({
      ok: true,
      severity: "watch"
    });
    expect(report.notes.some((note) => note.startsWith("frontend_ready_slow_ms:"))).toBe(true);
  });

  it("returns watch when diagnostics are degraded but probes are reachable", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? { health: { verdict: "watch", warnings: ["rss_watch:700MiB"] } }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toContain("backend_diagnostics_watch");
  });

  it("returns watch when a required Horizon scheduler snapshot is missing", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? { health: { verdict: "ok", warnings: [] }, runtime: {} }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100,
        horizonSchedulerRequired: true
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toContain("horizon_scheduler_missing");
  });

  it("returns watch for Horizon scheduler backlog and clock skew", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              latestHorizonScheduler: {
                generatedAt: new Date().toISOString(),
                summary: {
                  status: "ok",
                  overdueOpenMarketCountAfter: 3,
                  alertCount: 1,
                  appDbClockSkewMs: 2500,
                  clockSkewWarnMs: 2000
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toEqual(expect.arrayContaining([
      "horizon_scheduler_overdue_open_markets:3",
      "horizon_scheduler_alerts:1",
      "horizon_scheduler_clock_skew_ms:2500"
    ]));
  });

  it("returns ok and skips diagnostics when local diagnostics are admin-gated without operator auth", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/health/diagnostics")) {
        return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
      }

      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("ok");
    expect(report.notes).toContain("backend_diagnostics_auth_required");
    expect(report.checks.find((check) => check.name === "backend_diagnostics")).toMatchObject({
      ok: true,
      skipped: true,
      status: 401,
      error: "diagnostics_auth_required"
    });
  });

  it("returns bad when configured diagnostics auth is rejected", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/health/diagnostics")) {
        return new Response(JSON.stringify({ error: { code: "unauthorized" } }), { status: 401 });
      }

      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        diagnosticsCookie: "navi_session=stale",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("bad");
    expect(report.notes).toContain("backend_diagnostics_failed");
    expect(report.checks.find((check) => check.name === "backend_diagnostics")).toMatchObject({
      ok: false,
      status: 401
    });
    expect(report.checks.find((check) => check.name === "backend_diagnostics")?.skipped).toBeUndefined();
  });

  it("passes operator auth only to diagnostics when configured", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? { health: { verdict: "ok", warnings: [] } }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        diagnosticsCookie: "navi_session=admin_session",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("ok");
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/health/diagnostics",
      expect.objectContaining({
        headers: { cookie: "navi_session=admin_session" }
      })
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://backend.test/health/live",
      expect.not.objectContaining({ headers: expect.anything() })
    );
  });

  it("returns watch for gauntlet-shaped diagnostics pressure", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            database: { pool: { waitingCount: 1 } },
            requests: {
              windows: {
                fiveMinutes: {
                  error5xxCount: 1,
                  errorRate5xx: 0.02,
                  history: { count: 3, p95Ms: 1200, p99Ms: 2400 }
                }
              }
            },
            runtime: {
              latestLifecycleHeartbeat: {
                generatedAt: new Date().toISOString(),
                summary: { status: "blocked", missingResolutionCaseCount: 22 }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toEqual(expect.arrayContaining([
      "db_pool_waiting:1",
      "request_5xx_count:1",
      "request_5xx_rate:0.02",
      "history_p95_ms:1200",
      "history_p99_ms:2400",
      "lifecycle_blocked",
      "missing_resolution_cases:22"
    ]));
  });

  it("returns watch for low economy runway and missing faucet tables", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              economy: {
                status: "watch",
                platformTreasury: {
                  balance: "50000.000000",
                  verdict: "watch"
                },
                faucetTables: {
                  userFaucetState: false,
                  faucetClaims: true
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toEqual(expect.arrayContaining([
      "economy_platform_treasury_low:50000.000000",
      "economy_faucet_tables_missing"
    ]));
  });

  it("returns watch when economy flow telemetry is unavailable", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              economy: {
                status: "ok",
                platformTreasury: {
                  balance: "500000.000000",
                  verdict: "ok"
                },
                faucetTables: {
                  userFaucetState: true,
                  faucetClaims: true
                },
                flow: {
                  status: "unavailable"
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toContain("economy_flow_unavailable");
  });

  it("returns ok in production when runtime identity, migration, and backup are present", async () => {
    const generatedAt = new Date().toISOString();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-05-29T00:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "202605290001_runtime.sql",
                count: 12
              },
              backup: {
                status: "ok",
                ageMs: 60_000
              },
              latestHorizonScheduler: {
                generatedAt,
                summary: {
                  status: "ok",
                  overdueOpenMarketCountAfter: 0,
                  alertCount: 0,
                  appDbClockSkewMs: 100,
                  clockSkewWarnMs: 2000
                }
              },
              latestLifecycleHeartbeat: {
                generatedAt,
                summary: {
                  status: "ok",
                  missingResolutionCaseCount: 0,
                  recommendedResolutionCaseCount: 0,
                  reviewNeededResolutionCaseCount: 0
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "https://hachozeh.com",
        frontendUrl: "https://hachozeh.com",
        timeoutMs: 100,
        production: true,
        backupFreshMs: 25 * 60 * 60_000
      },
      { fetchImpl }
    );

    expect(report.production).toBe(true);
    expect(report.verdict).toBe("ok");
    expect(report.notes).toEqual(["all_checks_ok"]);
  });

  it("returns watch in production for fresh unresolved lifecycle backlog", async () => {
    const generatedAt = new Date().toISOString();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-05-29T00:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "202605290001_runtime.sql",
                count: 12
              },
              backup: {
                status: "ok",
                ageMs: 60_000
              },
              latestHorizonScheduler: {
                generatedAt,
                summary: {
                  status: "ok",
                  overdueOpenMarketCountAfter: 0,
                  alertCount: 0,
                  appDbClockSkewMs: 100,
                  clockSkewWarnMs: 2000
                }
              },
              latestLifecycleHeartbeat: {
                generatedAt,
                summary: {
                  status: "blocked",
                  missingResolutionCaseCount: 1,
                  recommendedResolutionCaseCount: 1,
                  reviewNeededResolutionCaseCount: 1
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "https://hachozeh.com",
        frontendUrl: "https://hachozeh.com",
        timeoutMs: 100,
        production: true,
        lifecycleStaleMs: 15 * 60_000,
        horizonSchedulerStaleMs: 2 * 60_000
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("watch");
    expect(report.notes).toEqual(expect.arrayContaining([
      "lifecycle_blocked",
      "missing_resolution_cases:1",
      "recommended_resolution_cases:1",
      "review_needed_resolution_cases:1"
    ]));
  });

  it("returns bad in production when lifecycle workers are missing", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-05-29T00:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "202605290001_runtime.sql",
                count: 12
              },
              backup: {
                status: "ok",
                ageMs: 60_000
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "https://hachozeh.com",
        frontendUrl: "https://hachozeh.com",
        timeoutMs: 100,
        production: true
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("bad");
    expect(report.notes).toEqual(expect.arrayContaining([
      "lifecycle_heartbeat_missing",
      "horizon_scheduler_missing"
    ]));
  });

  it("returns bad in production when lifecycle snapshots are stale or have backlogs", async () => {
    const staleGeneratedAt = new Date(Date.now() - 60 * 60_000).toISOString();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-05-29T00:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "202605290001_runtime.sql",
                count: 12
              },
              backup: {
                status: "ok",
                ageMs: 60_000
              },
              latestHorizonScheduler: {
                generatedAt: staleGeneratedAt,
                summary: {
                  status: "watch",
                  overdueOpenMarketCountAfter: 2,
                  alertCount: 1,
                  appDbClockSkewMs: 2500,
                  clockSkewWarnMs: 2000
                }
              },
              latestLifecycleHeartbeat: {
                generatedAt: staleGeneratedAt,
                summary: {
                  status: "blocked",
                  missingResolutionCaseCount: 1,
                  recommendedResolutionCaseCount: 1,
                  reviewNeededResolutionCaseCount: 1
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "https://hachozeh.com",
        frontendUrl: "https://hachozeh.com",
        timeoutMs: 100,
        production: true,
        lifecycleStaleMs: 15 * 60_000,
        horizonSchedulerStaleMs: 2 * 60_000
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("bad");
    expect(report.notes).toEqual(expect.arrayContaining([
      "lifecycle_blocked",
      "missing_resolution_cases:1",
      "recommended_resolution_cases:1",
      "review_needed_resolution_cases:1",
      "horizon_scheduler_watch",
      "horizon_scheduler_overdue_open_markets:2",
      "horizon_scheduler_alerts:1",
      "horizon_scheduler_clock_skew_ms:2500"
    ]));
    expect(report.notes.some((note) => note.startsWith("lifecycle_heartbeat_stale_ms:"))).toBe(true);
    expect(report.notes.some((note) => note.startsWith("horizon_scheduler_stale_ms:"))).toBe(true);
  });

  it("returns bad in production when runtime identity or backup proof is missing", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {},
              migration: {
                status: "unavailable",
                latest: null,
                count: null
              },
              backup: {
                status: "missing",
                ageMs: null
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "https://hachozeh.com",
        frontendUrl: "https://hachozeh.com",
        timeoutMs: 100,
        production: true
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("bad");
    expect(report.notes).toEqual(expect.arrayContaining([
      "runtime_commit_sha_missing",
      "runtime_build_timestamp_missing",
      "runtime_release_id_missing",
      "runtime_migration_unavailable",
      "runtime_backup_missing"
    ]));
  });

  it("can tolerate missing backup proof for launch-safe production monitoring", async () => {
    const generatedAt = new Date().toISOString();
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-05-29T00:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "202605290001_runtime.sql",
                count: 12
              },
              backup: {
                status: "unavailable",
                ageMs: null
              },
              latestHorizonScheduler: {
                generatedAt,
                summary: {
                  status: "ok",
                  overdueOpenMarketCountAfter: 0,
                  alertCount: 0,
                  appDbClockSkewMs: 100,
                  clockSkewWarnMs: 2000
                }
              },
              latestLifecycleHeartbeat: {
                generatedAt,
                summary: {
                  status: "ok",
                  missingResolutionCaseCount: 0,
                  recommendedResolutionCaseCount: 0,
                  reviewNeededResolutionCaseCount: 0
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "https://hachozeh.com",
        frontendUrl: "https://hachozeh.com",
        timeoutMs: 100,
        production: true,
        backupRequired: false
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("ok");
    expect(report.notes).toContain("runtime_backup_unavailable_allowed");
  });

  it("accepts managed-provider restore and PITR receipts as production backup proof", async () => {
    const generatedAt = new Date().toISOString();
    const receiptDir = mkdtempSync(join(tmpdir(), "hachozeh-doctor-receipts-"));
    const restoreReceipt = join(receiptDir, "restore.md");
    const pitrReceipt = join(receiptDir, "pitr.md");
    writeFileSync(restoreReceipt, "Status: PASS\nResult: restore_drill=pass\n");
    writeFileSync(pitrReceipt, "Status: PASS\nResult: pitr_drill=pass\n");
    vi.stubEnv("PITR_MODE", "managed-provider");
    vi.stubEnv("RESTORE_DRILL_RECEIPT_PATH", restoreReceipt);
    vi.stubEnv("PITR_DRILL_RECEIPT_PATH", pitrReceipt);
    vi.stubEnv("MIGRATION_RECOVERY_RECEIPT_MAX_AGE_HOURS", "720");

    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics")
        ? {
            health: { verdict: "ok", warnings: [] },
            runtime: {
              identity: {
                commitSha: "abc123",
                buildTimestamp: "2026-05-29T00:00:00.000Z",
                releaseId: "release-1"
              },
              migration: {
                status: "ok",
                latest: "202605290001_runtime.sql",
                count: 12
              },
              backup: {
                status: "unavailable",
                ageMs: null
              },
              latestHorizonScheduler: {
                generatedAt,
                summary: {
                  status: "ok",
                  overdueOpenMarketCountAfter: 0,
                  alertCount: 0,
                  appDbClockSkewMs: 100,
                  clockSkewWarnMs: 2000
                }
              },
              latestLifecycleHeartbeat: {
                generatedAt,
                summary: {
                  status: "ok",
                  missingResolutionCaseCount: 0,
                  recommendedResolutionCaseCount: 0,
                  reviewNeededResolutionCaseCount: 0
                }
              }
            }
          }
        : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    try {
      const report = await runPlatformDoctor(
        {
          backendBaseUrl: "https://hachozeh.com",
          frontendUrl: "https://hachozeh.com",
          timeoutMs: 100,
          production: true
        },
        { fetchImpl }
      );

      expect(report.verdict).toBe("ok");
      expect(report.notes).toContain("runtime_backup_unavailable_provider_managed_receipts_ok");
    } finally {
      vi.unstubAllEnvs();
      rmSync(receiptDir, { recursive: true, force: true });
    }
  });

  it("returns bad when diagnostics lose the health verdict contract", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      const payload = target.includes("/health/diagnostics") ? { status: "ok" } : { status: "ok" };

      return new Response(JSON.stringify(payload), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("bad");
    expect(report.notes).toContain("backend_diagnostics_contract_missing");
  });

  it("runs deep read checks against a selected open market", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);

      if (target.includes("/health/diagnostics")) {
        return new Response(JSON.stringify({ health: { verdict: "ok", warnings: [] } }), { status: 200 });
      }

      if (target.includes("/api/markets?status=open")) {
        return new Response(JSON.stringify({ markets: [{ marketKey: "market-a" }] }), { status: 200 });
      }

      if (target.includes("/stream?once=1")) {
        return new Response("event: market.snapshot\n\ndata: {}\n\n", {
          status: 200,
          headers: { "content-type": "text/event-stream; charset=utf-8" }
        });
      }

      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendBaseUrl: "http://front.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100,
        deep: true
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("ok");
    expect(report.deep).toBe(true);
    expect(report.selectedMarketKey).toBe("market-a");
    expect(report.checks.map((check) => check.name)).toEqual(expect.arrayContaining([
      "api_open_markets",
      "api_market",
      "api_market_history",
      "api_market_detail",
      "api_market_stream_once",
      "api_read_latency_summary",
      "frontend_market_detail",
      "frontend_portfolio"
    ]));
    expect(report.checks.find((check) => check.name === "api_read_latency_summary")?.payload).toMatchObject({
      market_detail: {
        attempts: 3,
        ok: 3,
        failed: 0
      },
      market_history_1d: {
        attempts: 3,
        ok: 3,
        failed: 0
      },
      portfolio_snapshot: {
        attempts: 3,
        ok: 3,
        failed: 0
      },
      portfolio_performance_day: {
        attempts: 3,
        ok: 3,
        failed: 0
      }
    });
  });

  it("returns bad when any required probe fails", async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const target = String(url);
      if (target.includes("/health/ready")) {
        return new Response(JSON.stringify({ status: "not_ready" }), { status: 503 });
      }

      return new Response(JSON.stringify({ status: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;

    const report = await runPlatformDoctor(
      {
        backendBaseUrl: "http://backend.test",
        frontendUrl: "http://front.test/trending.html",
        timeoutMs: 100
      },
      { fetchImpl }
    );

    expect(report.verdict).toBe("bad");
    expect(report.notes).toContain("backend_ready_failed");
  });
});
