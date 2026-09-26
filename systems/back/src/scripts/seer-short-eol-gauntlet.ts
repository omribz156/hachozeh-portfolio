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
import { approveOracleResolutionCase } from "../../../oracle/src/review-action-service";

type Phase = "setup" | "close" | "resolve";

type CandidateKind = "direction" | "threshold";

type ShortEolCandidate = {
  kind: CandidateKind;
  marketId: string;
  title: string;
  assetLabel: string;
  symbol: string;
  pairLabel: string;
  threshold?: number;
  candleOpenAt: string;
  closeAt: string;
  polySlug: string;
  polyQuestion: string;
  sourceUrl: string;
  sourceLabel: string;
  outcomes: Array<{
    id: string;
    label: string;
    evidenceKey: "up" | "down" | "yes" | "no";
    colorKey: string;
  }>;
};

type Manifest = {
  objectType: "seer_short_eol_gauntlet_manifest";
  runId: string;
  generatedAt: string;
  candidates: ShortEolCandidate[];
};

const SEER_ACTOR: RequestActor = {
  actorId: "system_seer_short_eol_gauntlet",
  mode: "session",
  sessionId: "system_seer_short_eol_gauntlet",
  role: "admin"
};

const OPERATOR_ACTOR: RequestActor = {
  actorId: "codex_short_eol_operator",
  mode: "session",
  sessionId: "codex_short_eol_gauntlet",
  role: "admin"
};

const CANDLE_OPEN_AT = "2026-05-10T22:00:00.000Z";
const CLOSE_AT = "2026-05-10T23:00:00.000Z";

const POLY_BASE_URL = "https://polymarket.com/market/";

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function readPhase(args: string[]): Phase {
  const phase = readFlag(args, "--phase") ?? "setup";
  if (phase !== "setup" && phase !== "close" && phase !== "resolve") {
    throw new Error("--phase must be setup, close, or resolve");
  }
  return phase;
}

function createRunId(): string {
  return `short_eol_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function manifestPath(runId: string): string {
  return pathResolve(
    process.cwd(),
    "../..",
    `workspace/test/runs/2026-05-10-18h-failed-gauntlet/manifests/seer-short-eol-gauntlet-${runId}.json`
  );
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

function directionCandidate(input: {
  assetLabel: string;
  symbol: string;
  polySlug: string;
  polyQuestion: string;
}): ShortEolCandidate {
  const base = `disc-cm-gauntlet-binance-${input.symbol.toLowerCase()}-direction-20260510-22z`;
  return {
    kind: "direction",
    marketId: base,
    title: `${input.assetLabel}: עלייה או ירידה בנר Binance של 22:00 UTC?`,
    assetLabel: input.assetLabel,
    symbol: input.symbol,
    pairLabel: `${input.symbol}/USDT`,
    candleOpenAt: CANDLE_OPEN_AT,
    closeAt: CLOSE_AT,
    polySlug: input.polySlug,
    polyQuestion: input.polyQuestion,
    sourceUrl: `https://www.binance.com/en/trade/${input.symbol}_USDT`,
    sourceLabel: `Binance ${input.symbol}/USDT - נר שעה`,
    outcomes: [
      {
        id: `${base}-up`,
        label: "עלייה",
        evidenceKey: "up",
        colorKey: "green"
      },
      {
        id: `${base}-down`,
        label: "ירידה",
        evidenceKey: "down",
        colorKey: "red"
      }
    ]
  };
}

function thresholdCandidate(input: {
  assetLabel: string;
  symbol: string;
  threshold: number;
  polySlug: string;
  polyQuestion: string;
}): ShortEolCandidate {
  const thresholdSlug = String(input.threshold).replace(".", "p");
  const base = `disc-cm-gauntlet-binance-${input.symbol.toLowerCase()}-above-${thresholdSlug}-20260510-23z`;
  return {
    kind: "threshold",
    marketId: base,
    title: `${input.assetLabel}: האם סגירת Binance תהיה מעל ${input.threshold.toLocaleString("en-US")} ב-23:00 UTC?`,
    assetLabel: input.assetLabel,
    symbol: input.symbol,
    pairLabel: `${input.symbol}/USDT`,
    threshold: input.threshold,
    candleOpenAt: CANDLE_OPEN_AT,
    closeAt: CLOSE_AT,
    polySlug: input.polySlug,
    polyQuestion: input.polyQuestion,
    sourceUrl: `https://www.binance.com/en/trade/${input.symbol}_USDT`,
    sourceLabel: `Binance ${input.symbol}/USDT - מחיר סגירת נר שעה`,
    outcomes: [
      {
        id: `${base}-yes`,
        label: "כן",
        evidenceKey: "yes",
        colorKey: "green"
      },
      {
        id: `${base}-no`,
        label: "לא",
        evidenceKey: "no",
        colorKey: "red"
      }
    ]
  };
}

function buildCandidates(): ShortEolCandidate[] {
  return [
    directionCandidate({
      assetLabel: "ביטקוין",
      symbol: "BTC",
      polySlug: "bitcoin-up-or-down-may-10-2026-6pm-et",
      polyQuestion: "Bitcoin Up or Down - May 10, 6PM ET"
    }),
    directionCandidate({
      assetLabel: "אתריום",
      symbol: "ETH",
      polySlug: "ethereum-up-or-down-may-10-2026-6pm-et",
      polyQuestion: "Ethereum Up or Down - May 10, 6PM ET"
    }),
    directionCandidate({
      assetLabel: "סולאנה",
      symbol: "SOL",
      polySlug: "solana-up-or-down-may-10-2026-6pm-et",
      polyQuestion: "Solana Up or Down - May 10, 6PM ET"
    }),
    directionCandidate({
      assetLabel: "XRP",
      symbol: "XRP",
      polySlug: "xrp-up-or-down-may-10-2026-6pm-et",
      polyQuestion: "XRP Up or Down - May 10, 6PM ET"
    }),
    directionCandidate({
      assetLabel: "דוג׳קוין",
      symbol: "DOGE",
      polySlug: "dogecoin-up-or-down-may-10-2026-6pm-et",
      polyQuestion: "Dogecoin Up or Down - May 10, 6PM ET"
    }),
    directionCandidate({
      assetLabel: "BNB",
      symbol: "BNB",
      polySlug: "bnb-up-or-down-may-10-2026-6pm-et",
      polyQuestion: "BNB Up or Down - May 10, 6PM ET"
    }),
    thresholdCandidate({
      assetLabel: "ביטקוין",
      symbol: "BTC",
      threshold: 82400,
      polySlug: "bitcoin-above-82400-on-may-10-2026-7pm-et",
      polyQuestion: "Bitcoin above 82,400 on May 10, 7PM ET?"
    }),
    thresholdCandidate({
      assetLabel: "ביטקוין",
      symbol: "BTC",
      threshold: 82000,
      polySlug: "bitcoin-above-82000-on-may-10-2026-7pm-et",
      polyQuestion: "Bitcoin above 82,000 on May 10, 7PM ET?"
    }),
    thresholdCandidate({
      assetLabel: "אתריום",
      symbol: "ETH",
      threshold: 2345,
      polySlug: "ethereum-above-2345-on-may-10-2026-7pm-et",
      polyQuestion: "Ethereum above 2,345 on May 10, 7PM ET?"
    }),
    thresholdCandidate({
      assetLabel: "אתריום",
      symbol: "ETH",
      threshold: 2375,
      polySlug: "ethereum-above-2375-on-may-10-2026-7pm-et",
      polyQuestion: "Ethereum above 2,375 on May 10, 7PM ET?"
    })
  ];
}

function buildResolutionRule(candidate: ShortEolCandidate): string {
  if (candidate.kind === "direction") {
    return `השוק מוכרע לפי נר השעה של ${candidate.pairLabel} ב-Binance שמתחיל ב-${candidate.candleOpenAt} ומסתיים ב-${candidate.closeAt}. אם מחיר הסגירה גדול או שווה למחיר הפתיחה, התוצאה הזוכה היא "עלייה". אחרת התוצאה הזוכה היא "ירידה".`;
  }

  return `השוק מוכרע לפי מחיר הסגירה של נר השעה של ${candidate.pairLabel} ב-Binance שמסתיים ב-${candidate.closeAt}. אם מחיר הסגירה גבוה מ-${candidate.threshold}, התוצאה הזוכה היא "כן". אחרת התוצאה הזוכה היא "לא".`;
}

function buildContract(candidate: ShortEolCandidate) {
  return {
    objectType: "market_contract_v1",
    version: "seer-contract-v1",
    measurement: candidate.title,
    measurementKind: candidate.kind === "direction" ? "price_direction" : "threshold_crossing",
    resultShape: candidate.kind === "direction" ? "up_down" : "yes_no",
    oracleCapability: "manual_resolution_required",
    resolutionAuthorityType: "canonical-data",
    resolutionSource: {
      url: candidate.sourceUrl,
      label: candidate.sourceLabel,
      sourceIds: ["src_binance_spot_candles"]
    },
    resolutionRule: buildResolutionRule(candidate),
    timeline: {
      closeAt: candidate.closeAt,
      timezone: "UTC",
      closeShape: `המסחר נסגר בסיום חלון השעה: ${candidate.closeAt}.`
    },
    outcomeMap: candidate.outcomes.map((outcome) => ({
      outcomeKind: outcome.evidenceKey,
      evidenceKey: outcome.evidenceKey,
      outcomeLabel: outcome.label,
      resolutionPath:
        candidate.kind === "direction"
          ? outcome.evidenceKey === "up"
            ? "זוכה אם מחיר הסגירה גדול או שווה למחיר הפתיחה."
            : "זוכה אם מחיר הסגירה נמוך ממחיר הפתיחה."
          : outcome.evidenceKey === "yes"
            ? `זוכה אם מחיר הסגירה גבוה מ-${candidate.threshold}.`
            : `זוכה אם מחיר הסגירה נמוך או שווה ל-${candidate.threshold}.`
    })),
    sourceRolePlan: {
      wake: [`Polymarket shape reference: ${POLY_BASE_URL}${candidate.polySlug}`],
      ground: [candidate.sourceLabel],
      resolve: [`${candidate.sourceLabel}: ${candidate.sourceUrl}`]
    },
    delayPolicy:
      "אם Binance אינו מציג את נר השעה או שהנתון אינו זמין בזמן, השוק נשאר סגור וממתין לבדיקה ידנית.",
    ambiguityPolicy:
      "אין להשתמש בבורסה אחרת, בצמד מסחר אחר, או במחיר בזמן אמת מחוץ לנר הרשמי שנבחר.",
    dataRevisionPolicy:
      "אם Binance משנה את נתון הנר לאחר ההכרעה, תיקון ייבדק ידנית ורק שינוי רשמי ברור יכול להצדיק תיקון.",
    payoutPolicy:
      "לאחר אישור הכרעה ידני, מנוע השוק מסמן פוזיציות כמסולקות ומשלם לפי התוצאה הזוכה.",
    referenceQuarantine: {
      source: "Polymarket",
      url: `${POLY_BASE_URL}${candidate.polySlug}`,
      rule: "Reference/source-of-shape only; never resolution authority."
    },
    reviewBlockers: []
  } as const;
}

async function createAndPublish(dbPool: Pool, candidate: ShortEolCandidate, runId: string) {
  const rule = buildResolutionRule(candidate);
  const draft = await createMarketDraft(
    dbPool,
    {
      marketId: candidate.marketId,
      familyKey: "seer-short-eol-binance-gauntlet",
      eventId: null,
      eventTitle: null,
      eventDescription: null,
      eventIcon: null,
      marketEnvironment: "test",
      title: candidate.title,
      description:
        "שוק גאונטלט קצר-טווח על בסיס צורת שוק Polymarket, עם מקור הכרעה קנוני ב-Binance. מיועד לבדיקת עומס ומחזור חיים במאגר המבודד.",
      categoryKey: "crypto",
      openAt: minutesAgo(5),
      closeAt: candidate.closeAt,
      resolutionSource: `${candidate.sourceLabel}: ${candidate.sourceUrl}`,
      resolutionRules: rule,
      oracleSourcePolicy: {
        preferredSourceIds: ["src_binance_spot_candles"],
        contextSourceIds: ["src_binance_spot_candles"],
        resolutionSourceIds: ["src_binance_spot_candles"],
        closeConditionSourceIds: [],
        requiresHumanReviewOnSourceConflict: true,
        requiresHumanReviewOnWeakAuthority: true,
        notes: [
          `polymarket-reference=${POLY_BASE_URL}${candidate.polySlug}`,
          "polymarket-is-not-resolution-authority",
          "manual-resolution-required-until-binance-adapter-exists"
        ]
      },
      marketContract: buildContract(candidate),
      liquidityB: "140.00000000",
      closeOnEventCompletion: false,
      eventCompletionCloseRequiresHumanApproval: false,
      outcomes: candidate.outcomes.map((outcome) => ({
        outcomeId: outcome.id,
        label: outcome.label,
        shortLabel: outcome.label,
        description: buildOutcomeDescription(candidate, outcome.evidenceKey),
        colorKey: outcome.colorKey
      })),
      idempotencyKey: `short-eol-create:${runId}:${candidate.marketId}`
    },
    SEER_ACTOR
  );

  const published = await publishMarket(
    dbPool,
    candidate.marketId,
    {
      seedAmount: "1000.000000",
      publishAt: new Date().toISOString(),
      note: "Short-EOL Seer gauntlet publish after user approval.",
      reviewId: `short-eol-review:${runId}:${candidate.marketId}`,
      checklistVersion: "seer-contract-v1-short-eol-gauntlet",
      managementApprovedAt: new Date().toISOString(),
      idempotencyKey: `short-eol-publish:${runId}:${candidate.marketId}`
    },
    SEER_ACTOR
  );

  return { draft, published };
}

function buildOutcomeDescription(candidate: ShortEolCandidate, evidenceKey: ShortEolCandidate["outcomes"][number]["evidenceKey"]): string {
  if (candidate.kind === "direction") {
    return evidenceKey === "up"
      ? "מחיר הסגירה של נר Binance גדול או שווה למחיר הפתיחה."
      : "מחיר הסגירה של נר Binance נמוך ממחיר הפתיחה.";
  }

  return evidenceKey === "yes"
    ? `מחיר הסגירה של נר Binance גבוה מ-${candidate.threshold}.`
    : `מחיר הסגירה של נר Binance נמוך או שווה ל-${candidate.threshold}.`;
}

async function ensureTradeUser(dbPool: Pool, runId: string, index: number): Promise<string> {
  const userId = `user_short_eol_${runId}_${index}`;
  const accountId = `acct_short_eol_${runId}_${index}_cash`;
  const handle = `shorteol_${createHash("sha256").update(userId).digest("hex").slice(0, 10)}`;

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
      values ($1, 'user_cash', $2, 'active', '1000.000000')
      on conflict (id) do update
      set status = 'active',
          balance_cached = '1000.000000',
          updated_at = now()
    `,
    [accountId, userId]
  );

  return userId;
}

async function seedTrades(dbPool: Pool, runId: string, candidate: ShortEolCandidate, marketIndex: number) {
  const env = loadAppEnv();
  const trades = [];

  for (const [outcomeIndex, outcome] of candidate.outcomes.entries()) {
    const userId = await ensureTradeUser(dbPool, runId, marketIndex * 10 + outcomeIndex);
    trades.push(
      await executeTrade(
        dbPool,
        env,
        candidate.marketId,
        {
          side: "buy",
          outcomeKey: outcome.id,
          contractSide: "yes",
          cashAmount: outcomeIndex === 0 ? "35.00" : "25.00",
          idempotencyKey: `short-eol-trade:${runId}:${candidate.marketId}:${outcome.evidenceKey}`
        },
        {
          actorId: userId
        }
      )
    );
  }

  return trades;
}

async function setup(): Promise<void> {
  const runId = readFlag(process.argv.slice(2), "--run-id") ?? createRunId();
  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);
  const candidates = buildCandidates();

  try {
    const results = [];

    for (const [index, candidate] of candidates.entries()) {
      const publish = await createAndPublish(dbPool, candidate, runId);
      const trades = await seedTrades(dbPool, runId, candidate, index);
      results.push({ candidate, ...publish, trades });
    }

    const manifest: Manifest = {
      objectType: "seer_short_eol_gauntlet_manifest",
      runId,
      generatedAt: new Date().toISOString(),
      candidates
    };
    const path = await writeManifest(manifest);

    console.log(JSON.stringify({ objectType: "seer_short_eol_gauntlet_setup", runId, manifestPath: path, results }, null, 2));
  } finally {
    await dbPool.end();
  }
}

async function closePhase(): Promise<void> {
  const path = readFlag(process.argv.slice(2), "--manifest");
  if (!path) {
    throw new Error("Missing --manifest");
  }

  const manifest = await readManifest(path);
  const env = loadAppEnv();
  const dbPool = createDbPool(env.db);

  try {
    const results = [];

    for (const candidate of manifest.candidates) {
      const result = await closeMarket(
        dbPool,
        candidate.marketId,
        {
          triggerType: "scheduled_time",
          reason: "שוק גאונטלט קצר-טווח הגיע לזמן הסגירה.",
          sourceUrl: candidate.sourceUrl,
          note: `${candidate.sourceLabel}; Polymarket reference ${POLY_BASE_URL}${candidate.polySlug}`,
          oracleCaseId: null,
          triggeredByOracleId: null,
          approvedByHumanId: OPERATOR_ACTOR.actorId,
          idempotencyKey: `short-eol-close:${manifest.runId}:${candidate.marketId}`,
          requestedAt: new Date().toISOString()
        },
        OPERATOR_ACTOR
      );
      results.push({ candidate: candidate.marketId, result });
    }

    console.log(JSON.stringify({ objectType: "seer_short_eol_gauntlet_close", runId: manifest.runId, results }, null, 2));
  } finally {
    await dbPool.end();
  }
}

async function fetchBinanceCandle(candidate: ShortEolCandidate) {
  const startMs = new Date(candidate.candleOpenAt).getTime();
  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", `${candidate.symbol}USDT`);
  url.searchParams.set("interval", "1h");
  url.searchParams.set("startTime", String(startMs));
  url.searchParams.set("limit", "1");

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance request failed for ${candidate.symbol}: ${response.status}`);
  }

  const rows = (await response.json()) as unknown;
  if (!Array.isArray(rows) || !Array.isArray(rows[0])) {
    throw new Error(`Unexpected Binance kline shape for ${candidate.symbol}`);
  }

  const row = rows[0] as unknown[];
  return {
    openTime: Number(row[0]),
    open: Number(row[1]),
    high: Number(row[2]),
    low: Number(row[3]),
    close: Number(row[4]),
    closeTime: Number(row[6])
  };
}

function winningOutcome(candidate: ShortEolCandidate, candle: Awaited<ReturnType<typeof fetchBinanceCandle>>) {
  if (candidate.kind === "direction") {
    return candle.close >= candle.open
      ? candidate.outcomes.find((outcome) => outcome.evidenceKey === "up")!
      : candidate.outcomes.find((outcome) => outcome.evidenceKey === "down")!;
  }

  return candle.close > Number(candidate.threshold)
    ? candidate.outcomes.find((outcome) => outcome.evidenceKey === "yes")!
    : candidate.outcomes.find((outcome) => outcome.evidenceKey === "no")!;
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

    for (const candidate of manifest.candidates) {
      const candle = await fetchBinanceCandle(candidate);
      const winner = winningOutcome(candidate, candle);
      const claimSummary =
        candidate.kind === "direction"
          ? `${candidate.pairLabel} candle open=${candle.open}, close=${candle.close}; winner=${winner.label}.`
          : `${candidate.pairLabel} candle close=${candle.close}, threshold=${candidate.threshold}; winner=${winner.label}.`;
      const inspection = await inspectOracleMarket(
        dbPool,
        {
          marketId: candidate.marketId,
          caseType: "resolution_check",
          sources: [
            {
              sourceId: "src_binance_spot_candles",
              sourceUrl: candidate.sourceUrl,
              sourceLabel: candidate.sourceLabel,
              sourceType: "canonical-data",
              claimSummary
            }
          ],
          winningOutcomeId: winner.id,
          reasonSummary: `Binance kline evidence resolved short-EOL gauntlet market. ${claimSummary}`
        },
        {
          persistResult: true
        }
      );
      const resolution = await approveOracleResolutionCase(
        dbPool,
        inspection.oracleCase.oracleCaseId,
        OPERATOR_ACTOR,
        {
          reviewNote: `Manual approval for short-EOL Binance gauntlet evidence. ${claimSummary}`,
          idempotencyKey: `short-eol-resolve:${manifest.runId}:${candidate.marketId}`
        }
      );
      results.push({ candidate: candidate.marketId, candle, winner, inspection, resolution });
    }

    console.log(JSON.stringify({ objectType: "seer_short_eol_gauntlet_resolve", runId: manifest.runId, results }, null, 2));
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

  if (phase === "close") {
    await closePhase();
    return;
  }

  await resolvePhase();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
