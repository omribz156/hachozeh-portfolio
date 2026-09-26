import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseArgs,
  parseOracleCaseHistoryCommandInput,
  parseOracleCredibleReportingEvaluateCommandOptions,
  parseOracleLifecycleHeartbeatCommandOptions,
  parseOracleLifecycleRunCommandOptions,
  parseOracleCapabilityCheckCommandInput,
  parseOracleObservedEventCommandInput,
  parseOracleOperatorResolveCommandInput,
  parseOracleOperatorResolveCommandExecutionInput,
  parseOracleReviewCaseCommandInput,
  parseOracleReadLimitCommandOptions,
  parseOracleTradingViewFxSnapshotCommandOptions,
  parseOracleVoidMarketCommandInput,
  validateOracleReviewCaseCommandPayload
} from "../../oracle/src/oracle-cli-args";

async function readOracleSource(relativePath: string): Promise<string> {
  try {
    return await readFile(join(process.cwd(), "..", "oracle", "src", relativePath), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }

    return readFile(join(process.cwd(), "systems", "oracle", "src", relativePath), "utf8");
  }
}

describe("oracle parseArgs", () => {
  it("parses oracle alerts through the Commander proof path", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "alerts",
      "--market-status",
      "open",
      "--review-stale-hours",
      "6",
      "--recommended-stale-hours",
      "12",
      "--json"
    ]);

    expect(parsed.command).toBe("alerts");
    expect(parsed.jsonMode).toBe(true);
    expect(parsed.helpRequested).toBe(false);
    expect(Object.fromEntries(parsed.flags)).toEqual({
      "market-status": "open",
      "review-stale-hours": "6",
      "recommended-stale-hours": "12"
    });
  });

  it("returns Commander-generated help for oracle alerts", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "alerts",
      "--help"
    ]);

    expect(parsed.command).toBe("alerts");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: alerts");
    expect(parsed.helpText).toContain("--market-status [status]");
  });

  it("returns command help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "alerts",
      "--review-stale-hours",
      "soon",
      "--help"
    ]);

    expect(parsed.command).toBe("alerts");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: alerts");
  });

  it("returns operator-resolve help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "operator-resolve",
      "--mode",
      "auto",
      "--help"
    ]);

    expect(parsed.command).toBe("operator-resolve");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: operator-resolve");
  });

  it("returns lifecycle-heartbeat help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "lifecycle-heartbeat",
      "--max-ticks",
      "forever",
      "--help"
    ]);

    expect(parsed.command).toBe("lifecycle-heartbeat");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: lifecycle-heartbeat");
  });

  it("returns review-action help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "approve-resolution-case",
      "--help"
    ]);

    expect(parsed.command).toBe("approve-resolution-case");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: approve-resolution-case");
  });

  it("returns operator-observed-event help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "operator-observed-event",
      "--observed-at",
      "soon",
      "--help"
    ]);

    expect(parsed.command).toBe("operator-observed-event");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: operator-observed-event");
  });

  it("returns capability-check help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "capability-check",
      "--help"
    ]);

    expect(parsed.command).toBe("capability-check");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: capability-check");
  });

  it("returns TradingView snapshot help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "capture-tradingview-fx-snapshot",
      "--observed-at",
      "soon",
      "--help"
    ]);

    expect(parsed.command).toBe("capture-tradingview-fx-snapshot");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: capture-tradingview-fx-snapshot");
  });

  it("returns credible-reporting-evaluate help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "credible-reporting-evaluate",
      "--dry-run",
      "maybe",
      "--help"
    ]);

    expect(parsed.command).toBe("credible-reporting-evaluate");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: credible-reporting-evaluate");
  });

  it("returns void-market help before payload validation", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "void-market",
      "--requested-at",
      "soon",
      "--help"
    ]);

    expect(parsed.command).toBe("void-market");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: void-market");
  });

  it("parses resolve-inbox through the Commander command tree", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "resolve-inbox",
      "--limit",
      "3",
      "--json"
    ]);

    expect(parsed.command).toBe("resolve-inbox");
    expect(parsed.jsonMode).toBe(true);
    expect(parsed.helpRequested).toBe(false);
    expect(Object.fromEntries(parsed.flags)).toEqual({
      limit: "3"
    });
  });

  it("returns Commander-generated help for resolve-inbox", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "resolve-inbox",
      "--help"
    ]);

    expect(parsed.command).toBe("resolve-inbox");
    expect(parsed.helpRequested).toBe(true);
    expect(parsed.helpText).toContain("Usage: resolve-inbox");
    expect(parsed.helpText).toContain("--limit [value]");
  });

  it("parses operator mutation flags through the Commander command tree", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "operator-resolve",
      "--market",
      "next-prime-minister",
      "--mode",
      "manual",
      "--winning-outcome-key",
      "option-a",
      "--reason-summary",
      "Final official result",
      "--evidence-url",
      "https://example.test/result",
      "--evidence-label",
      "Example source",
      "--approve",
      "--json"
    ]);

    expect(parsed.command).toBe("operator-resolve");
    expect(parsed.jsonMode).toBe(true);
    expect(Object.fromEntries(parsed.flags)).toMatchObject({
      market: "next-prime-minister",
      mode: "manual",
      "winning-outcome-key": "option-a",
      "reason-summary": "Final official result",
      "evidence-url": "https://example.test/result",
      "evidence-label": "Example source",
      approve: "true"
    });
  });

  it("keeps flag values that match a command name", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "operator-observed-event",
      "--market",
      "market_1",
      "--summary",
      "operator-resolve",
      "--source-label",
      "resolve-inbox"
    ]);

    expect(parsed.command).toBe("operator-observed-event");
    expect(Object.fromEntries(parsed.flags)).toMatchObject({
      market: "market_1",
      summary: "operator-resolve",
      "source-label": "resolve-inbox"
    });
  });

  it("tolerates unknown flags without process-exiting", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "resolve-inbox",
      "--limit",
      "3",
      "--future-flag",
      "kept-loose"
    ]);

    expect(parsed.command).toBe("resolve-inbox");
    expect(Object.fromEntries(parsed.flags)).toEqual({
      limit: "3"
    });
  });

  it("tolerates extra positional arguments for legacy compatibility", () => {
    const parsed = parseArgs([
      "node",
      "oracle-cli.ts",
      "resolve-inbox",
      "extra-positional",
      "--limit",
      "3"
    ]);

    expect(parsed.command).toBe("resolve-inbox");
    expect(Object.fromEntries(parsed.flags)).toEqual({
      limit: "3"
    });
  });

  it.each([
    [
      ["node", "oracle-cli.ts", "review-queue", "--case-status", "approved"],
      "case-status must be one of: review_needed, recommended, no_action, all."
    ],
    [
      ["node", "oracle-cli.ts", "review-queue", "--limit", "abc"],
      "limit must be a positive integer."
    ],
    [
      ["node", "oracle-cli.ts", "alerts", "--review-stale-hours", "soon"],
      "review-stale-hours must be a positive number."
    ],
    [
      ["node", "oracle-cli.ts", "operator-resolve", "--mode", "auto"],
      "--mode must be test, official, or manual."
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "operator-resolve",
        "--mode",
        "manual",
        "--market",
        "market_1",
        "--reason-summary",
        "Final result",
        "--evidence-url",
        "https://example.test/result",
        "--evidence-label",
        "Example source",
        "--approve",
        "maybe"
      ],
      "Flag --approve must be true or false."
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "operator-resolve",
        "--mode",
        "manual",
        "--market",
        "market_1",
        "--reason-summary",
        "Final result",
        "--evidence-url",
        "https://example.test/result",
        "--evidence-label",
        "Example source",
        "--persist",
        "maybe"
      ],
      "Flag --persist must be true or false."
    ],
    [
      ["node", "oracle-cli.ts", "resolve-inbox", "--limit", "many"],
      "limit must be a positive integer."
    ],
    [
      ["node", "oracle-cli.ts", "official-final-intake", "--limit", "0"],
      "limit must be a positive integer."
    ],
    [
      ["node", "oracle-cli.ts", "case-history", "--market", "market_1", "--case-status", "approved"],
      "case-status must be one of: review_needed, recommended, no_action, all."
    ],
    [
      ["node", "oracle-cli.ts", "lifecycle-run", "--dry-run", "maybe"],
      "Flag --dry-run must be true or false."
    ],
    [
      ["node", "oracle-cli.ts", "lifecycle-run", "--now", "soon"],
      "Flag --now must be an ISO timestamp."
    ],
    [
      ["node", "oracle-cli.ts", "lifecycle-heartbeat", "--max-ticks", "forever"],
      "max-ticks must be a positive integer."
    ],
    [
      ["node", "oracle-cli.ts", "lifecycle-heartbeat", "--interval-ms", "-1"],
      "interval-ms must be a non-negative integer."
    ],
    [
      ["node", "oracle-cli.ts", "lifecycle-heartbeat", "--operator-reminders", "maybe"],
      "Flag --operator-reminders must be true or false."
    ],
    [
      ["node", "oracle-cli.ts", "approve-resolution-case"],
      "Missing required flag --case"
    ],
    [
      ["node", "oracle-cli.ts", "approve-close-condition-case"],
      "Missing required flag --case"
    ],
    [
      ["node", "oracle-cli.ts", "reject-case"],
      "Missing required flag --case"
    ],
    [
      ["node", "oracle-cli.ts", "request-more-evidence"],
      "Missing required flag --case"
    ],
    [
      ["node", "oracle-cli.ts", "operator-observed-event", "--summary", "Observed context"],
      "Missing required flag --market"
    ],
    [
      ["node", "oracle-cli.ts", "operator-observed-event", "--market", "market_1"],
      "Missing required flag --summary"
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "operator-observed-event",
        "--market",
        "market_1",
        "--summary",
        "Observed context",
        "--observed-at",
        "soon"
      ],
      "Flag --observed-at must be an ISO timestamp."
    ],
    [
      ["node", "oracle-cli.ts", "capability-check", "--measurement", "final_score", "--shape", "yes_no"],
      "Missing required flag --source-id"
    ],
    [
      ["node", "oracle-cli.ts", "capability-check", "--source-id", "src_1", "--shape", "yes_no"],
      "Missing required flag --measurement"
    ],
    [
      ["node", "oracle-cli.ts", "capability-check", "--source-id", "src_1", "--measurement", "final_score"],
      "Missing required flag --shape"
    ],
    [
      ["node", "oracle-cli.ts", "capture-tradingview-fx-snapshot", "--symbol", "USDILS"],
      "Missing required flag --market"
    ],
    [
      ["node", "oracle-cli.ts", "capture-tradingview-fx-snapshot", "--market", "market_1"],
      "Missing required flag --symbol"
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "capture-tradingview-fx-snapshot",
        "--market",
        "market_1",
        "--symbol",
        "USDILS",
        "--observed-at",
        "soon"
      ],
      "Flag --observed-at must be an ISO timestamp."
    ],
    [
      ["node", "oracle-cli.ts", "credible-reporting-evaluate", "--dry-run", "true"],
      "Missing required flag --market"
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "credible-reporting-evaluate",
        "--market",
        "market_1",
        "--dry-run",
        "maybe"
      ],
      "Flag --dry-run must be true or false."
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "credible-reporting-evaluate",
        "--market",
        "market_1",
        "--now",
        "soon"
      ],
      "Flag --now must be an ISO timestamp."
    ],
    [
      ["node", "oracle-cli.ts", "void-market", "--reason", "bad fixture"],
      "Missing required flag --market"
    ],
    [
      ["node", "oracle-cli.ts", "void-market", "--market", "market_1"],
      "Missing required flag --reason"
    ],
    [
      [
        "node",
        "oracle-cli.ts",
        "void-market",
        "--market",
        "market_1",
        "--reason",
        "bad fixture",
        "--requested-at",
        "soon"
      ],
      "Flag --requested-at must be an ISO timestamp."
    ]
  ])("validates Oracle command payload flags before execution for %s", (argv, message) => {
    expect(() => parseArgs(argv)).toThrow(message);
  });

  it("normalizes Oracle read limit command options", () => {
    const parsed = parseOracleReadLimitCommandOptions(new Map([
      ["market", "market_1"],
      ["limit", "3"]
    ]));

    expect(parsed).toEqual({
      marketId: "market_1",
      limit: 3
    });
  });

  it("normalizes Oracle case-history command input", () => {
    const parsed = parseOracleCaseHistoryCommandInput(new Map([
      ["market", "market_1"],
      ["case-status", "recommended"],
      ["case-type", "resolution_check"],
      ["limit", "2"]
    ]));

    expect(parsed).toEqual({
      marketId: "market_1",
      options: {
        caseStatus: "recommended",
        caseType: "resolution_check",
        limit: 2
      }
    });
  });

  it("normalizes Oracle lifecycle command options", () => {
    const now = "2026-06-12T08:00:00.000Z";

    expect(parseOracleLifecycleRunCommandOptions(new Map([
      ["market", "market_1"],
      ["limit", "2"],
      ["dry-run", "true"],
      ["now", now]
    ]))).toMatchObject({
      marketId: "market_1",
      limit: 2,
      dryRun: true,
      now: new Date(now)
    });

    expect(parseOracleLifecycleHeartbeatCommandOptions(new Map([
      ["max-ticks", "2"],
      ["interval-ms", "1000"],
      ["operator-reminders", "false"]
    ]))).toMatchObject({
      dryRun: false,
      maxTicks: 2,
      intervalMs: 1000,
      operatorRemindersEnabled: false,
      persistSnapshot: true
    });
  });

  it("preserves lifecycle heartbeat zero interval compatibility", () => {
    expect(parseOracleLifecycleHeartbeatCommandOptions(new Map([
      ["interval-ms", "0"]
    ]))).toMatchObject({
      dryRun: false,
      intervalMs: 0,
      persistSnapshot: true
    });
  });

  it("preserves broad lifecycle date parsing compatibility", () => {
    expect(parseOracleLifecycleRunCommandOptions(new Map([
      ["now", "2026-06-12"]
    ])).now?.toISOString()).toBe("2026-06-12T00:00:00.000Z");
  });

  it.each([
    ["market", "Missing required flag --market"],
    ["reason-summary", "Missing required flag --reason-summary"],
    ["evidence-url", "Missing required flag --evidence-url"],
    ["evidence-label", "Missing required flag --evidence-label"]
  ])("requires operator-resolve %s payload flag", (flagName, message) => {
    const flags = new Map([
      ["market", "market_1"],
      ["mode", "manual"],
      ["reason-summary", "Final result"],
      ["evidence-url", "https://example.test/result"],
      ["evidence-label", "Example source"]
    ]);
    flags.delete(flagName);

    expect(() => parseOracleOperatorResolveCommandInput(flags)).toThrow(message);
  });

  it("normalizes operator-resolve optional flags", () => {
    const parsed = parseOracleOperatorResolveCommandInput(new Map([
      ["market", "market_1"],
      ["mode", "official"],
      ["winning-outcome-key", "yes"],
      ["reason-summary", "Final result"],
      ["evidence-url", "https://example.test/result"],
      ["evidence-label", "Example source"],
      ["approve", "true"],
      ["persist", "false"],
      ["idempotency-key", "resolve_1"]
    ]));

    expect(parsed).toMatchObject({
      marketId: "market_1",
      mode: "official",
      winningOutcomeKey: "yes",
      reasonSummary: "Final result",
      evidenceUrl: "https://example.test/result",
      evidenceLabel: "Example source",
      approve: true,
      persistResult: false,
      idempotencyKey: "resolve_1"
    });
  });

  it("normalizes operator-resolve execution actor and request", () => {
    const parsed = parseOracleOperatorResolveCommandExecutionInput(new Map([
      ["market", "market_1"],
      ["mode", "official"],
      ["reason-summary", "Final result"],
      ["evidence-url", "https://example.test/result"],
      ["evidence-label", "Example source"],
      ["actor-id", " operator_1 "],
      ["session-id", " session_1 "]
    ]));

    expect(parsed.actor).toEqual({
      actorId: "operator_1",
      mode: "session",
      sessionId: "session_1",
      role: "admin"
    });
    expect(parsed.request).toMatchObject({
      marketId: "market_1",
      mode: "official",
      reasonSummary: "Final result",
      evidenceUrl: "https://example.test/result",
      evidenceLabel: "Example source"
    });
  });

  it("normalizes Oracle review-action command inputs", () => {
    const parsed = parseOracleReviewCaseCommandInput(
      "approve-resolution-case",
      new Map([
        ["case", "ocase_1"],
        ["actor-id", "operator_1"],
        ["session-id", "session_1"],
        ["review-note", " Approved by CLI "],
        ["idempotency-key", "idem_1"]
      ])
    );

    expect(parsed).toEqual({
      oracleCaseId: "ocase_1",
      actor: {
        actorId: "operator_1",
        mode: "session",
        sessionId: "session_1",
        role: "admin"
      },
      request: {
        reviewNote: "Approved by CLI",
        idempotencyKey: "idem_1"
      }
    });
  });

  it("builds Oracle review-action defaults", () => {
    const parsed = parseOracleReviewCaseCommandInput(
      "request-more-evidence",
      new Map([
        ["case", "ocase_2"]
      ])
    );

    expect(parsed.oracleCaseId).toBe("ocase_2");
    expect(parsed.actor).toEqual({
      actorId: "oracle_cli_operator",
      mode: "session",
      sessionId: "oracle_cli_session",
      role: "admin"
    });
    expect(parsed.request.reviewNote).toBeNull();
    expect(parsed.request.idempotencyKey).toMatch(/^oracle-request-more-evidence:ocase_2:/);
  });

  it("validates Oracle review-action required payloads without building execution defaults", () => {
    expect(() => validateOracleReviewCaseCommandPayload(new Map())).toThrow("Missing required flag --case");
    expect(() => validateOracleReviewCaseCommandPayload(new Map([["case", "ocase_3"]]))).not.toThrow();
  });

  it("normalizes Oracle operator-observed-event command inputs", () => {
    const parsed = parseOracleObservedEventCommandInput(new Map([
      ["market", " market_1 "],
      ["summary", " Observed context "],
      ["observed-at", "2026-05-17T23:15:00.000Z"],
      ["observed-outcome-key", " austria "],
      ["source-url", " https://example.test/result "],
      ["source-label", " Example source "],
      ["note", " Operator note "],
      ["idempotency-key", " observed_1 "],
      ["actor-id", " operator_1 "]
    ]));

    expect(parsed).toEqual({
      actor: {
        actorId: "operator_1",
        mode: "session",
        sessionId: "oracle_cli_session",
        role: "admin"
      },
      request: {
        marketId: "market_1",
        summary: "Observed context",
        observedAt: "2026-05-17T23:15:00.000Z",
        observedOutcomeKey: "austria",
        sourceUrl: "https://example.test/result",
        sourceLabel: "Example source",
        note: "Operator note",
        idempotencyKey: "observed_1"
      }
    });
  });

  it("normalizes Oracle capability-check command inputs", () => {
    const parsed = parseOracleCapabilityCheckCommandInput(new Map([
      ["source-id", " src_1 "],
      ["measurement", " final_score "],
      ["shape", " yes_no "],
      ["source-url", " https://example.test/source "]
    ]));

    expect(parsed).toEqual({
      sourceId: "src_1",
      measurementKind: "final_score",
      resultShape: "yes_no",
      sourceUrl: "https://example.test/source"
    });
  });

  it("normalizes Oracle TradingView snapshot command inputs", () => {
    const parsed = parseOracleTradingViewFxSnapshotCommandOptions(new Map([
      ["market", " usd-ils "],
      ["symbol", " usdils "],
      ["observed-at", "2026-06-02T20:59:00.000Z"],
      ["idempotency-key", " idem_1 "]
    ]));

    expect(parsed).toEqual({
      marketId: "usd-ils",
      symbol: "usdils",
      observedAt: new Date("2026-06-02T20:59:00.000Z"),
      idempotencyKey: "idem_1"
    });
  });

  it("normalizes Oracle credible-reporting-evaluate command inputs", () => {
    const parsed = parseOracleCredibleReportingEvaluateCommandOptions(new Map([
      ["market", " market_1 "],
      ["dry-run", "true"],
      ["now", "2026-06-02T20:59:00.000Z"]
    ]));

    expect(parsed).toEqual({
      marketId: "market_1",
      dryRun: true,
      now: new Date("2026-06-02T20:59:00.000Z")
    });
  });

  it("normalizes Oracle void-market command inputs", () => {
    const parsed = parseOracleVoidMarketCommandInput(new Map([
      ["market", " market_1 "],
      ["reason", " bad fixture "],
      ["note", " Operator note "],
      ["idempotency-key", " void_1 "],
      ["requested-at", "2026-06-02T20:59:00.000Z"],
      ["actor-id", " operator_1 "],
      ["session-id", " session_1 "]
    ]));

    expect(parsed).toEqual({
      marketId: "market_1",
      actor: {
        actorId: "operator_1",
        mode: "session",
        sessionId: "session_1",
        role: "admin"
      },
      request: {
        reason: "bad fixture",
        note: "Operator note",
        idempotencyKey: "void_1",
        requestedAt: "2026-06-02T20:59:00.000Z"
      }
    });
  });

  it("builds Oracle void-market command defaults", () => {
    const parsed = parseOracleVoidMarketCommandInput(new Map([
      ["market", "market_2"],
      ["reason", "bad fixture"]
    ]));

    expect(parsed.marketId).toBe("market_2");
    expect(parsed.actor).toEqual({
      actorId: "oracle_cli_operator",
      mode: "session",
      sessionId: "oracle_cli_session",
      role: "admin"
    });
    expect(parsed.request.note).toBeNull();
    expect(parsed.request.requestedAt).toBeUndefined();
    expect(parsed.request.idempotencyKey).toMatch(/^oracle-void:market_2:/);
  });

  it("keeps Oracle read-command payload parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain('from "zod"');
    expect(argsSource).toContain("parseOracleReviewQueueCommandOptions");
    expect(argsSource).toContain("parseOracleAlertsCommandOptions");
    expect(cliSource).toContain("parseOracleReviewQueueCommandOptions");
    expect(cliSource).toContain("parseOracleAlertsCommandOptions");
    expect(cliSource).not.toContain("const result = await readOracleReviewQueue(dbPool, {");
    expect(cliSource).not.toContain("const result = await readOracleAlerts(dbPool, {");
    expect(cliSource).not.toContain("Number(parsed.flags.get(\"review-stale-hours\"))");
  });

  it("keeps Oracle operator-resolve payload parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleOperatorResolveCommandInput");
    expect(argsSource).toContain("parseOracleOperatorResolveCommandExecutionInput");
    expect(cliSource).toContain("parseOracleOperatorResolveCommandExecutionInput");
    const operatorResolveSource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"operator-resolve\")"),
      cliSource.indexOf("if (parsed.command === \"operator-observed-event\")")
    );

    expect(cliSource).not.toContain("const rawMode = requireFlag(parsed.flags, \"mode\")");
    expect(cliSource).not.toContain("rawMode !== \"test\"");
    expect(operatorResolveSource).not.toContain("parsed.flags.get(\"actor-id\") ?? \"oracle_cli_operator\"");
    expect(operatorResolveSource).not.toContain("parsed.flags.get(\"session-id\") ?? \"oracle_cli_session\"");
  });

  it("keeps Oracle read and lifecycle command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleReadLimitCommandOptions");
    expect(argsSource).toContain("parseOracleCaseHistoryCommandInput");
    expect(argsSource).toContain("parseOracleLifecycleRunCommandOptions");
    expect(argsSource).toContain("parseOracleLifecycleHeartbeatCommandOptions");
    expect(cliSource).toContain("parseOracleReadLimitCommandOptions");
    expect(cliSource).toContain("parseOracleCaseHistoryCommandInput");
    expect(cliSource).toContain("parseOracleLifecycleRunCommandOptions");
    expect(cliSource).toContain("parseOracleLifecycleHeartbeatCommandOptions");
    expect(cliSource).not.toContain("Number(parsed.flags.get(\"max-ticks\"))");
    expect(cliSource).not.toContain("Number(parsed.flags.get(\"interval-ms\"))");
  });

  it("keeps Oracle review-action command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleReviewCaseCommandInput");
    expect(argsSource).toContain("validateOracleReviewCaseCommandPayload");
    expect(cliSource).toContain("parseOracleReviewCaseCommandInput");
    const validationSource = argsSource.slice(
      argsSource.indexOf("function validateOracleCommandPayload"),
      argsSource.indexOf("export function parseArgs")
    );
    const reviewActionSource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"approve-resolution-case\")"),
      cliSource.indexOf("if (parsed.command === \"intake-candidate-evidence\")")
    );

    expect(validationSource).toContain("validateOracleReviewCaseCommandPayload(parsed.flags)");
    expect(validationSource).not.toContain("parseOracleReviewCaseCommandInput(parsed.command, parsed.flags)");
    expect(reviewActionSource).not.toContain("const oracleCaseId = requireFlag(parsed.flags, \"case\")");
    expect(reviewActionSource).not.toContain("parsed.flags.get(\"actor-id\") ?? \"oracle_cli_operator\"");
    expect(reviewActionSource).not.toContain("parsed.flags.get(\"session-id\") ?? \"oracle_cli_session\"");
  });

  it("keeps Oracle operator-observed-event command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleObservedEventCommandInput");
    expect(cliSource).toContain("parseOracleObservedEventCommandInput");
    const observedEventSource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"operator-observed-event\")"),
      cliSource.indexOf("if (parsed.command === \"void-market\")")
    );

    expect(observedEventSource).not.toContain("marketId: requireFlag(parsed.flags, \"market\")");
    expect(observedEventSource).not.toContain("summary: requireFlag(parsed.flags, \"summary\")");
    expect(observedEventSource).not.toContain("parsed.flags.get(\"actor-id\") ?? \"oracle_cli_operator\"");
  });

  it("keeps Oracle capability-check command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleCapabilityCheckCommandInput");
    expect(cliSource).toContain("parseOracleCapabilityCheckCommandInput");
    const capabilitySource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"capability-check\")"),
      cliSource.indexOf("if (parsed.command === \"alerts\")")
    );

    expect(capabilitySource).not.toContain("sourceId: requireFlag(parsed.flags, \"source-id\")");
    expect(capabilitySource).not.toContain("measurementKind: requireFlag(parsed.flags, \"measurement\")");
    expect(capabilitySource).not.toContain("resultShape: requireFlag(parsed.flags, \"shape\")");
  });

  it("keeps Oracle TradingView snapshot command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleTradingViewFxSnapshotCommandOptions");
    expect(cliSource).toContain("parseOracleTradingViewFxSnapshotCommandOptions");
    const snapshotSource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"capture-tradingview-fx-snapshot\")"),
      cliSource.indexOf("if (parsed.command === \"credible-reporting-evaluate\")")
    );

    expect(snapshotSource).not.toContain("marketId: resolveMarketIdFromInput(requireFlag(parsed.flags, \"market\"))");
    expect(snapshotSource).not.toContain("symbol: requireFlag(parsed.flags, \"symbol\")");
    expect(snapshotSource).not.toContain("observedAt: readDateFlag(parsed.flags, \"observed-at\")");
  });

  it("keeps Oracle credible-reporting-evaluate command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleCredibleReportingEvaluateCommandOptions");
    expect(cliSource).toContain("parseOracleCredibleReportingEvaluateCommandOptions");
    const evaluateSource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"credible-reporting-evaluate\")"),
      cliSource.indexOf("if (parsed.command === \"family-route-audit\")")
    );

    expect(evaluateSource).not.toContain("marketId: resolveMarketIdFromInput(requireFlag(parsed.flags, \"market\"))");
    expect(evaluateSource).not.toContain("dryRun: readBooleanFlag(parsed.flags, \"dry-run\") ?? false");
    expect(evaluateSource).not.toContain("now: readDateFlag(parsed.flags, \"now\")");
  });

  it("keeps Oracle void-market command parsing in Zod-backed helpers", async () => {
    const [argsSource, cliSource] = await Promise.all([
      readOracleSource("oracle-cli-args.ts"),
      readOracleSource("oracle-cli.ts")
    ]);

    expect(argsSource).toContain("parseOracleVoidMarketCommandInput");
    expect(argsSource).toContain("validateOracleVoidMarketCommandPayload");
    expect(cliSource).toContain("parseOracleVoidMarketCommandInput");
    const validationSource = argsSource.slice(
      argsSource.indexOf("function validateOracleCommandPayload"),
      argsSource.indexOf("export function parseArgs")
    );
    const voidSource = cliSource.slice(
      cliSource.indexOf("if (parsed.command === \"void-market\")"),
      cliSource.indexOf("if (parsed.command === \"capture-tradingview-fx-snapshot\")")
    );

    expect(validationSource).toContain("validateOracleVoidMarketCommandPayload(parsed.flags)");
    expect(validationSource).not.toContain("parseOracleVoidMarketCommandInput(parsed.flags)");
    expect(voidSource).not.toContain("const marketId = resolveMarketIdFromInput(requireFlag(parsed.flags, \"market\"))");
    expect(voidSource).not.toContain("const request: VoidMarketRequest");
    expect(voidSource).not.toContain("parsed.flags.get(\"actor-id\") ?? \"oracle_cli_operator\"");
  });
});
