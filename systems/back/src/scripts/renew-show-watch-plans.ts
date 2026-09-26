import { Command } from "commander";

import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { upsertMarketWatchPlan, type MarketWatchCheckerKind } from "../market-watch/service";

type RenewOptions = {
  runAt?: string[];
  nextRunAt?: string;
  json?: boolean;
};

type ShowWatchPlanDefinition = {
  id: string;
  eventId: string;
  sourceUrls: string[];
  entities: string[];
  keywords: string[];
  proximityChars: number;
  note: string;
};

const CHECKER_KIND: MarketWatchCheckerKind = "show_official_keywords";

const SHOW_WATCH_PLANS: ShowWatchPlanDefinition[] = [
  {
    id: "dancing_stars_israel_s5_official_watch",
    eventId: "evt-dancing-stars-israel-season-5-winner",
    sourceUrls: ["https://www.mako.co.il/tv-dancing_with_the_stars"],
    entities: [
      "שירי מימון ורפאל פליישמן",
      "אבישג סמברג ואיוון דניסוב",
      "אמיר בנאי ורומי נוף",
      "בר ברימר וסנה סוקול",
      "מתן פרץ ואלינור גרשפלד",
      "נועה כהן ואיתן קריפס",
      "מלי לוי ודני יוחטמן",
      "עדן גולן וארטיום ליאסקובסקי",
      "דיאן שוורץ ולוטם מדמוני",
      "צחי הלוי ונינה סול",
      "נת'ניאל בוזוליץ' וג'וליה שחר"
    ],
    keywords: ["הודחו", "הודחה", "הודח", "פרשו", "פרשה", "פרש", "הזוכה", "זכו"],
    proximityChars: 160,
    note:
      "Dancing S5 official Mako watch; scheduled episode-day pings only, no mutation. Renewed by show-watch-plan operator script."
  },
  {
    id: "power_couple_israel_2026_official_watch",
    eventId: "evt-power-couple-israel-2026-winner",
    sourceUrls: ["https://13tv.co.il/shows/power-couple/", "https://13tv.co.il/allshows/series/728/"],
    entities: [
      "אודיה פינטו ואליאור סופר",
      "אודיה ואליאור",
      "אורי ואנה בנאי",
      "אורי ואנה",
      "אסי ועדי בוזגלו",
      "אסי ועדי",
      "חני נחמיאס ויהודה אליאס",
      "חני ויהודה",
      "עומרי ודורין קנדה",
      "עומרי ודורין",
      "שיר טרן ואלעד תורג'מן",
      "שיר ואלעד",
      "שרון חזיז ורונן נוף",
      "שרון ורונן"
    ],
    keywords: ["הודח", "הודחה", "הודחו", "פרש", "פרשה", "פרשו", "זוכה", "זכו", "הזוכים", "הגמר"],
    proximityChars: 180,
    note:
      "Power Couple Israel 2026 official watch; scheduled episode-day pings only, no mutation. Renewed by show-watch-plan operator script."
  },
  {
    id: "the_voice_israel_s6_official_watch",
    eventId: "evt-the-voice-israel-season-6-winning-mentor",
    sourceUrls: ["https://13tv.co.il/entertainment/the-voice/", "https://13tv.co.il/entertainment/the-voice/season-06/episodes/"],
    entities: ["עידן רייכל", "עדן בן זקן", "נועה קירל", "סטטיק"],
    keywords: ["הודח", "הודחה", "הודחו", "פרש", "פרשה", "פרשו", "הזוכה", "זכה", "זכתה", "נבחרת"],
    proximityChars: 160,
    note:
      "The Voice Israel S6 official watch; scheduled episode-day pings only, no mutation. Renewed by show-watch-plan operator script."
  }
];

function readTimestamp(value: string, field: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error(`${field} must be a valid timestamp.`);
  }
  return date.toISOString();
}

function firstFutureRunAt(runAt: string[], now = Date.now()): string | null {
  return runAt
    .map((value) => new Date(value))
    .filter((date) => Number.isFinite(date.getTime()) && date.getTime() > now)
    .sort((a, b) => a.getTime() - b.getTime())[0]?.toISOString() ?? null;
}

async function runRenew(options: RenewOptions): Promise<void> {
  const runAt = (options.runAt ?? []).map((value) => readTimestamp(value, "--run-at"));
  const nextRunAt = options.nextRunAt ? readTimestamp(options.nextRunAt, "--next-run-at") : firstFutureRunAt(runAt);

  if (!nextRunAt) {
    throw new Error("Provide --next-run-at or at least one future --run-at timestamp.");
  }

  const pool = createDbPool(loadAppEnv().db);
  try {
    const plans = [];
    for (const definition of SHOW_WATCH_PLANS) {
      plans.push(
        await upsertMarketWatchPlan(pool, {
          id: definition.id,
          eventId: definition.eventId,
          checkerKind: CHECKER_KIND,
          enabled: true,
          timezone: "Asia/Jerusalem",
          runPolicy: {
            runAt,
            proximityChars: definition.proximityChars
          },
          nextRunAt,
          sourceUrls: definition.sourceUrls,
          entities: definition.entities,
          keywords: definition.keywords,
          note: definition.note
        })
      );
    }

    const payload = {
      objectType: "show_watch_plan_renewal",
      renewedCount: plans.length,
      nextRunAt,
      planIds: plans.map((plan) => plan.id),
      plans
    };

    console.log(options.json ? JSON.stringify(payload, null, 2) : JSON.stringify(payload, null, 2));
  } finally {
    await pool.end();
  }
}

const program = new Command("renew-show-watch-plans")
  .description("Renew current show event watch plans with an explicit scheduled run block.")
  .option("--run-at <timestamp>", "Scheduled run timestamp; repeatable.", (value, previous: string[] = []) => [...previous, value])
  .option("--next-run-at <timestamp>", "Explicit next run timestamp.")
  .option("--json")
  .action(runRenew);

if (require.main === module) {
  program.parseAsync(process.argv).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
