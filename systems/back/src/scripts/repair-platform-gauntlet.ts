import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve as pathResolve } from "node:path";

import type { Pool } from "pg";

import type { RequestActor } from "../auth/actor-resolver";
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { executeTrade } from "../engine/trading/trade-service";
import { closeMarket } from "../lifecycle/horizon/close-market-service";
import { createMarketDraft } from "../lifecycle/management/create-market-draft-service";
import { publishMarket } from "../lifecycle/management/publish-market-service";
import { inspectOracleMarket } from "../../../oracle/src/inspect-market-service";
import {
  approveOracleCloseConditionCase,
  approveOracleResolutionCase
} from "../../../oracle/src/review-action-service";

type Phase = "setup" | "resolve";

type RepairMarketKind = "scheduled" | "early";

type RepairMarket = {
  kind: RepairMarketKind;
  marketId: string;
  title: string;
  closeAt: string;
  outcomeYesId: string;
  outcomeNoId: string;
  sourceUrl: string;
  sourceLabel: string;
};

type Manifest = {
  objectType: "repair_platform_gauntlet_manifest";
  runId: string;
  generatedAt: string;
  markets: RepairMarket[];
};

const SEER_ACTOR: RequestActor = {
  actorId: "system_seer_repair_gauntlet",
  mode: "session",
  sessionId: "system_seer_repair_gauntlet",
  role: "admin"
};

const OPERATOR_ACTOR: RequestActor = {
  actorId: "codex_repair_gauntlet_operator",
  mode: "session",
  sessionId: "codex_repair_gauntlet",
  role: "admin"
};

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function readPhase(args: string[]): Phase {
  const phase = readFlag(args, "--phase") ?? "setup";
  if (phase !== "setup" && phase !== "resolve") {
    throw new Error("--phase must be setup or resolve");
  }
  return phase;
}

function createRunId(): string {
  return `repair_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function secondsFromNow(seconds: number): string {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function manifestPath(runId: string): string {
  return pathResolve(process.cwd(), "../..", `workspace/test/repair-platform-gauntlet-${runId}.json`);
}

async function writeManifest(manifest: Manifest): Promise<string> {
  const path = manifestPath(manifest.runId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(manifest, null, 2), "utf8");
  return path;
}

async function readManifest(path: string): Promise<Manifest> {
  return JSON.parse(await readFile(path, "utf8")) as Manifest;
}

function buildContract(input: {
  market: RepairMarket;
  closeShape: string;
  measurement: string;
  resolutionRule: string;
}) {
  return {
    objectType: "market_contract_v1",
    version: "seer-contract-v1",
    measurement: input.measurement,
    timeline: {
      closeAt: input.market.closeAt,
      timezone: "UTC",
      closeShape: input.closeShape
    },
    resolutionAuthorityType: "controlled-rehearsal",
    resolutionSource: {
      url: input.market.sourceUrl,
      label: input.market.sourceLabel,
      sourceIds: ["src_repair_gauntlet_control"]
    },
    resolutionRule: input.resolutionRule,
    outcomeMap: [
      {
        outcomeKind: "yes",
        outcomeLabel: "כן",
        resolutionPath: "זוכה אם מקור החזרה המבוקר מאשר שהתרחיש הושלם בהצלחה."
      },
      {
        outcomeKind: "no",
        outcomeLabel: "לא",
        resolutionPath: "זוכה אם מקור החזרה המבוקר מאשר שהתרחיש נכשל או לא הושלם."
      }
    ],
    sourceRolePlan: {
      wake: [input.market.sourceLabel],
      ground: [input.market.sourceLabel],
      resolve: [`${input.market.sourceLabel}: ${input.market.sourceUrl}`]
    },
    delayPolicy:
      "אם מקור החזרה המבוקר לא זמין או לא חד-משמעי, השוק נשאר בהמתנה עד בדיקת מפעיל.",
    ambiguityPolicy:
      "אין הכרעה לפי פרשנות חופשית. רק קייס Oracle מאושר עם מקור החזרה המבוקר יכול להכריע.",
    payoutPolicy:
      "לאחר אישור הכרעה, מנוע השוק מסמן פוזיציות כמסולקות ומשלם לפי התוצאה הזוכה.",
    reviewBlockers: []
  } as const;
}

function buildMarkets(runId: string): RepairMarket[] {
  const slug = runId.replace(/_/g, "-");

  return [
    {
      kind: "scheduled",
      marketId: `disc-cm-repair-scheduled-close-${slug}`,
      title: "האם שוק בדיקת הסגירה המתוזמנת ייסגר ויוכרע בהצלחה?",
      closeAt: secondsFromNow(90),
      outcomeYesId: `disc-cm-repair-scheduled-close-${slug}-yes`,
      outcomeNoId: `disc-cm-repair-scheduled-close-${slug}-no`,
      sourceUrl: `https://example.com/hachozeh/repair-gauntlet/${runId}/scheduled`,
      sourceLabel: "מקור חזרה מבוקר - סגירה מתוזמנת"
    },
    {
      kind: "early",
      marketId: `disc-cm-repair-early-close-${slug}`,
      title: "האם שוק בדיקת הסגירה המוקדמת יושלם לפני זמן הסגירה המתוכנן?",
      closeAt: secondsFromNow(3600),
      outcomeYesId: `disc-cm-repair-early-close-${slug}-yes`,
      outcomeNoId: `disc-cm-repair-early-close-${slug}-no`,
      sourceUrl: `https://example.com/hachozeh/repair-gauntlet/${runId}/early`,
      sourceLabel: "מקור חזרה מבוקר - סגירה מוקדמת"
    }
  ];
}

async function createAndPublish(dbPool: Pool, market: RepairMarket, runId: string) {
  const openAt = minutesAgo(2);
  const resolutionRule =
    market.kind === "scheduled"
      ? "השוק מוכרע ל-'כן' אם שוק הבדיקה נסגר במסלול סגירה מתוזמנת ולאחר מכן אושר בקייס Oracle מבוקר."
      : "השוק מוכרע ל-'כן' אם שוק הבדיקה נסגר מוקדם דרך קייס Oracle מאושר ולאחר מכן אושר בקייס הכרעה מבוקר.";

  const draft = await createMarketDraft(
    dbPool,
    {
      marketId: market.marketId,
      familyKey: "repair-gauntlet-control",
      eventId: null,
      eventTitle: null,
      eventDescription: null,
      eventIcon: null,
      marketEnvironment: "test",
      title: market.title,
      description:
        "שוק חזרה מבוקר לבדיקת חיבורי Seer, Back, Front, Horizon, Oracle והתחשבנות. לא שוק מוצר.",
      categoryKey: "systems",
      openAt,
      closeAt: market.closeAt,
      resolutionSource: `${market.sourceLabel}: ${market.sourceUrl}`,
      resolutionRules: resolutionRule,
      oracleSourcePolicy: {
        preferredSourceIds: ["src_repair_gauntlet_control"],
        contextSourceIds: ["src_repair_gauntlet_control"],
        resolutionSourceIds: ["src_repair_gauntlet_control"],
        closeConditionSourceIds:
          market.kind === "early" ? ["src_repair_gauntlet_control"] : [],
        requiresHumanReviewOnSourceConflict: true,
        requiresHumanReviewOnWeakAuthority: false,
        notes: [
          `wake-role=${market.sourceLabel}`,
          `ground-role=${market.sourceLabel}`,
          `resolve-role=${market.sourceLabel}: ${market.sourceUrl}`
        ]
      },
      marketContract: buildContract({
        market,
        closeShape:
          market.kind === "scheduled"
            ? "סגירה בזמן המתוזמן של שוק החזרה."
            : "מותרת סגירה מוקדמת רק לאחר קייס Oracle מאושר.",
        measurement: market.title,
        resolutionRule
      }),
      liquidityB: "120.00000000",
      closeOnEventCompletion: market.kind === "early",
      eventCompletionCloseRequiresHumanApproval: market.kind === "early",
      outcomes: [
        {
          outcomeId: market.outcomeYesId,
          label: "כן",
          shortLabel: "כן",
          description: "המחזור הושלם לפי מקור החזרה המבוקר.",
          colorKey: "green"
        },
        {
          outcomeId: market.outcomeNoId,
          label: "לא",
          shortLabel: "לא",
          description: "המחזור לא הושלם לפי מקור החזרה המבוקר.",
          colorKey: "red"
        }
      ],
      idempotencyKey: `repair-gauntlet-create:${runId}:${market.marketId}`
    },
    SEER_ACTOR
  );

  const published = await publishMarket(
    dbPool,
    market.marketId,
    {
      seedAmount: "1000.000000",
      publishAt: new Date().toISOString(),
      note: "Repair gauntlet controlled publish.",
      reviewId: `repair-review:${runId}:${market.marketId}`,
      checklistVersion: "repair-gauntlet-v1",
      managementApprovedAt: new Date().toISOString(),
      idempotencyKey: `repair-gauntlet-publish:${runId}:${market.marketId}`
    },
    SEER_ACTOR
  );

  return { draft, published };
}

async function ensureTradeUser(dbPool: Pool, runId: string): Promise<string> {
  const userId = `user_repair_gauntlet_${runId}`;
  const accountId = `acct_repair_gauntlet_${runId}_cash`;
  const handle = `repair_${createHash("sha256").update(userId).digest("hex").slice(0, 10)}`;

  await dbPool.query(
    `
      insert into users (id, handle, status, role, trade_access_status)
      values ($1, $2, 'active', 'user', 'enabled')
      on conflict (id) do update
      set status = 'active',
          role = 'user',
          trade_access_status = 'enabled',
          updated_at = now()
    `,
    [userId, handle]
  );

  await dbPool.query(
    `
      insert into accounts (id, type, owner_id, status, balance_cached)
      values ($1, 'user_cash', $2, 'active', '500.000000')
      on conflict (id) do update
      set status = 'active',
          balance_cached = '500.000000',
          updated_at = now()
    `,
    [accountId, userId]
  );

  return userId;
}

async function tradeYes(dbPool: Pool, runId: string, market: RepairMarket) {
  const env = loadAppEnv();
  const userId = await ensureTradeUser(dbPool, runId);

  return executeTrade(
    dbPool,
    env,
    market.marketId,
    {
      side: "buy",
      outcomeKey: market.outcomeYesId,
      contractSide: "yes",
      cashAmount: "25.00",
      idempotencyKey: `repair-gauntlet-trade:${runId}:${market.marketId}:yes`
    },
    {
      actorId: userId
    }
  );
}

async function setup(): Promise<void> {
  const runId = readFlag(process.argv.slice(2), "--run-id") ?? createRunId();
  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);
  const markets = buildMarkets(runId);

  try {
    const results = [];

    for (const market of markets) {
      const publish = await createAndPublish(dbPool, market, runId);
      const trade = await tradeYes(dbPool, runId, market);
      results.push({ market, ...publish, trade });
    }

    const manifest: Manifest = {
      objectType: "repair_platform_gauntlet_manifest",
      runId,
      generatedAt: new Date().toISOString(),
      markets
    };
    const path = await writeManifest(manifest);

    console.log(JSON.stringify({ objectType: "repair_platform_gauntlet_setup", runId, manifestPath: path, results }, null, 2));
  } finally {
    await dbPool.end();
  }
}

async function closeScheduled(dbPool: Pool, runId: string, market: RepairMarket) {
  const closeAtMs = new Date(market.closeAt).getTime();
  const waitMs = closeAtMs + 1000 - Date.now();

  if (waitMs > 0) {
    await new Promise((resolveWait) => setTimeout(resolveWait, waitMs));
  }

  return closeMarket(
    dbPool,
    market.marketId,
    {
      triggerType: "scheduled_time",
      reason: "שוק החזרה הגיע לזמן הסגירה המתוזמן.",
      sourceUrl: null,
      note: market.title,
      oracleCaseId: null,
      triggeredByOracleId: null,
      approvedByHumanId: null,
      idempotencyKey: `repair-gauntlet-close-scheduled:${runId}:${market.marketId}`,
      requestedAt: new Date().toISOString()
    },
    OPERATOR_ACTOR
  );
}

async function closeEarly(dbPool: Pool, runId: string, market: RepairMarket) {
  const inspection = await inspectOracleMarket(
    dbPool,
    {
      marketId: market.marketId,
      caseType: "close_condition_check",
      sources: [
        {
          sourceId: "src_repair_gauntlet_control",
          sourceUrl: `${market.sourceUrl}/close`,
          sourceLabel: market.sourceLabel,
          sourceType: "official",
          claimSummary: "מקור החזרה המבוקר מאשר שהאירוע הושלם לפני זמן הסגירה."
        }
      ],
      closeConditionSatisfied: true,
      reasonSummary: "מקור החזרה המבוקר מאשר סגירה מוקדמת."
    },
    {
      persistResult: true
    }
  );

  return approveOracleCloseConditionCase(
    dbPool,
    inspection.oracleCase.oracleCaseId,
    OPERATOR_ACTOR,
    {
      reviewNote: "אישור חזרה מבוקר לסגירה מוקדמת.",
      idempotencyKey: `repair-gauntlet-close-early:${runId}:${market.marketId}`
    }
  );
}

async function resolveYes(dbPool: Pool, runId: string, market: RepairMarket) {
  const inspection = await inspectOracleMarket(
    dbPool,
    {
      marketId: market.marketId,
      caseType: "resolution_check",
      sources: [
        {
          sourceId: "src_repair_gauntlet_control",
          sourceUrl: `${market.sourceUrl}/resolution`,
          sourceLabel: market.sourceLabel,
          sourceType: "official",
          claimSummary: "מקור החזרה המבוקר מאשר שהתוצאה הזוכה היא כן."
        }
      ],
      winningOutcomeId: market.outcomeYesId,
      reasonSummary: "מקור החזרה המבוקר מאשר מחזור מוצלח."
    },
    {
      persistResult: true
    }
  );

  return approveOracleResolutionCase(
    dbPool,
    inspection.oracleCase.oracleCaseId,
    OPERATOR_ACTOR,
    {
      reviewNote: "אישור חזרה מבוקר להכרעה כן.",
      idempotencyKey: `repair-gauntlet-resolve:${runId}:${market.marketId}`
    }
  );
}

async function resolvePhase(): Promise<void> {
  const path = readFlag(process.argv.slice(2), "--manifest");

  if (!path) {
    throw new Error("Missing --manifest");
  }

  const manifest = await readManifest(path);
  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    const results = [];

    for (const market of manifest.markets) {
      const close =
        market.kind === "scheduled"
          ? await closeScheduled(dbPool, manifest.runId, market)
          : await closeEarly(dbPool, manifest.runId, market);
      const resolution = await resolveYes(dbPool, manifest.runId, market);
      results.push({ market, close, resolution });
    }

    console.log(JSON.stringify({ objectType: "repair_platform_gauntlet_resolution", runId: manifest.runId, results }, null, 2));
  } finally {
    await dbPool.end();
  }
}

async function main(): Promise<void> {
  const phase = readPhase(process.argv.slice(2));

  if (phase === "setup") {
    await setup();
    return;
  }

  await resolvePhase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
