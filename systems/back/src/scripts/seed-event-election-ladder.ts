import type { Pool } from "pg";

import type { RequestActor } from "../auth/actor-resolver";
import { loadAppEnv } from "../config/env";
import { createDbPool } from "../db/client/pool";
import { executeTrade } from "../engine/trading/trade-service";
import { createMarketDraft } from "../lifecycle/management/create-market-draft-service";
import { publishMarket } from "../lifecycle/management/publish-market-service";

type ElectionChild = {
  monthKey: string;
  label: string;
  monthName: string;
  closeAt: string;
  yesTradeAmount: string;
  noTradeAmount: string;
};

type ExistingMarketRow = {
  id: string;
  status: "draft" | "open" | "closed" | "resolved" | "voided";
};

const EVENT_ID = "evt-israel-election-by-month-2026";
const FAMILY_KEY = "israel-election-timing";
const EVENT_TITLE = "מתי יתקיימו הבחירות בישראל ב-2026?";
const EVENT_DESCRIPTION =
  "אירוע בדיקה למצב event-mode: שורת ילדים חודשית בלעדית, רק חודש אחד יכול להיפתח כ-'כן'.";
const CATEGORY_KEY = "politics";
const LIQUIDITY_B = "300.00000000";
const SEED_AMOUNT = "60000.000000";
const SOURCE_LABEL = "מקורות רשמיים לבחירות בישראל";
const SOURCE_URL = "https://main.knesset.gov.il/mk/elections/Pages/default.aspx";

const ACTOR: RequestActor = {
  actorId: "system_event_seed",
  mode: "session",
  sessionId: "system_event_seed",
  role: "admin"
};

const TRADE_ACTOR: Pick<RequestActor, "actorId"> = {
  actorId: "seed_user_1"
};

const CHILDREN: ElectionChild[] = [
  {
    monthKey: "jun",
    label: "יוני",
    monthName: "יוני",
    closeAt: "2026-06-30T23:59:00+03:00",
    yesTradeAmount: "45.000000",
    noTradeAmount: "80.000000"
  },
  {
    monthKey: "jul",
    label: "יולי",
    monthName: "יולי",
    closeAt: "2026-07-31T23:59:00+03:00",
    yesTradeAmount: "60.000000",
    noTradeAmount: "70.000000"
  },
  {
    monthKey: "aug",
    label: "אוגוסט",
    monthName: "אוגוסט",
    closeAt: "2026-08-31T23:59:00+03:00",
    yesTradeAmount: "75.000000",
    noTradeAmount: "60.000000"
  },
  {
    monthKey: "sep",
    label: "ספטמבר",
    monthName: "ספטמבר",
    closeAt: "2026-09-30T23:59:00+03:00",
    yesTradeAmount: "95.000000",
    noTradeAmount: "50.000000"
  },
  {
    monthKey: "oct",
    label: "אוקטובר",
    monthName: "אוקטובר",
    closeAt: "2026-10-31T23:59:00+02:00",
    yesTradeAmount: "115.000000",
    noTradeAmount: "40.000000"
  },
  {
    monthKey: "nov",
    label: "נובמבר",
    monthName: "נובמבר",
    closeAt: "2026-11-30T23:59:00+02:00",
    yesTradeAmount: "135.000000",
    noTradeAmount: "35.000000"
  },
  {
    monthKey: "dec",
    label: "דצמבר",
    monthName: "דצמבר",
    closeAt: "2026-12-31T23:59:00+02:00",
    yesTradeAmount: "160.000000",
    noTradeAmount: "25.000000"
  }
];

function readFlag(args: string[], flag: string): string | null {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] ?? null : null;
}

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
}

function marketId(child: ElectionChild): string {
  return `disc-cm-event-israel-election-by-${child.monthKey}-2026`;
}

function outcomeId(child: ElectionChild, outcome: "yes" | "no"): string {
  return `${marketId(child)}-${outcome}`;
}

function buildContract(child: ElectionChild) {
  const title = buildTitle(child);
  const resolutionRule = `כן אם הבחירות לכנסת בישראל יתקיימו במהלך ${child.monthName} 2026, לפי פרסום רשמי או מקור בחירות רשמי. אחרת לא.`;

  return {
    objectType: "market_contract_v1",
    version: "seer-contract-v1",
    operational: {
      environment: "test",
      createdFor: "event-election-ladder-fixture"
    },
    measurementKind: "israel_election_by_month",
    resultShape: "binary",
    lifecycleFit: "manual_resolution_required",
    oracleCapability: "manual_resolution_required",
    measurement: title,
    timeline: {
      closeAt: child.closeAt,
      timezone: "Asia/Jerusalem",
      closeShape: `סגירה בסוף ${child.monthName} 2026, 23:59 שעון ישראל.`
    },
    resolutionAuthorityType: "official-election-source",
    resolutionSource: {
      url: SOURCE_URL,
      label: SOURCE_LABEL,
      sourceIds: ["src_knesset_elections"]
    },
    resolutionRule,
    outcomeMap: [
      {
        outcomeKind: "yes",
        outcomeLabel: "כן",
        resolutionPath: "זוכה אם הבחירות לכנסת בישראל התקיימו במהלך החודש הנמדד."
      },
      {
        outcomeKind: "no",
        outcomeLabel: "לא",
        resolutionPath: "זוכה אם הבחירות לכנסת בישראל לא התקיימו במהלך החודש הנמדד."
      }
    ],
    sourceRolePlan: {
      wake: [SOURCE_LABEL],
      ground: [SOURCE_LABEL],
      resolve: [`${SOURCE_LABEL}: ${SOURCE_URL}`]
    },
    delayPolicy:
      "אם המקור הרשמי מתעכב או אינו חד-משמעי, השוק נשאר בהמתנה עד בדיקת מפעיל.",
    ambiguityPolicy:
      "אין הכרעה לפי שמועות או הערכות. ההכרעה דורשת מקור רשמי או בדיקת מפעיל מול מקור בחירות אמין.",
    payoutPolicy:
      "לאחר אישור הכרעה, מנוע השוק מסמן פוזיציות כמסולקות ומשלם לפי התוצאה הזוכה.",
    reviewBlockers: [],
    event: {
      eventId: EVENT_ID,
      eventTitle: EVENT_TITLE,
      eventChildLabel: child.label,
      resolutionPolicy: "exclusive_first_hit"
    }
  } as const;
}

function buildTitle(child: ElectionChild): string {
  return `האם הבחירות בישראל יתקיימו במהלך ${child.monthName} 2026?`;
}

async function readExistingMarket(pool: Pool, id: string): Promise<ExistingMarketRow | null> {
  const result = await pool.query<ExistingMarketRow>(
    `
      select id, status
      from markets
      where id = $1
      limit 1
    `,
    [id]
  );

  return result.rows[0] ?? null;
}

async function repairExistingMarket(pool: Pool, child: ElectionChild): Promise<void> {
  const resolutionRules = `כן אם הבחירות לכנסת בישראל יתקיימו במהלך ${child.monthName} 2026. אחרת לא.`;
  const oracleSourcePolicy = {
    preferredSourceIds: ["src_knesset_elections"],
    contextSourceIds: ["src_knesset_elections"],
    resolutionSourceIds: ["src_knesset_elections"],
    closeConditionSourceIds: [],
    requiresHumanReviewOnSourceConflict: true,
    requiresHumanReviewOnWeakAuthority: true,
    notes: [
      `event-id=${EVENT_ID}`,
      `event-child-label=${child.label}`,
      "exclusive month-bucket election fixture for event-mode front contract"
    ]
  };

  await pool.query(
    `
      update events
      set
        title = $2,
        description = $3,
        category_key = $4,
        market_family_key = $5,
        resolution_policy = 'exclusive_first_hit',
        sibling_resolution_requires_human_approval = true,
        updated_at = now()
      where id = $1
    `,
    [EVENT_ID, EVENT_TITLE, EVENT_DESCRIPTION, CATEGORY_KEY, FAMILY_KEY]
  );

  await pool.query(
    `
      update markets
      set
        event_id = $2,
        event_child_label = $3,
        market_family_key = $4,
        title = $5,
        description = $6,
        category_key = $7,
        market_environment = 'test',
        close_at = $8,
        resolution_source = $9,
        resolution_rules = $10,
        oracle_source_policy = $11::jsonb,
        market_contract = $12::jsonb
      where id = $1
    `,
    [
      marketId(child),
      EVENT_ID,
      child.label,
      FAMILY_KEY,
      buildTitle(child),
      "שוק בדיקה ל-event-mode: ילד בינארי בלעדי בתוך אירוע חודשי של בחירות בישראל.",
      CATEGORY_KEY,
      child.closeAt,
      `${SOURCE_LABEL}: ${SOURCE_URL}`,
      resolutionRules,
      JSON.stringify(oracleSourcePolicy),
      JSON.stringify(buildContract(child))
    ]
  );
}

async function createDraftIfNeeded(pool: Pool, child: ElectionChild): Promise<ExistingMarketRow["status"]> {
  const id = marketId(child);
  const existing = await readExistingMarket(pool, id);

  if (existing) {
    await repairExistingMarket(pool, child);
    return existing.status;
  }

  await createMarketDraft(
    pool,
    {
      marketId: id,
      familyKey: FAMILY_KEY,
      eventId: EVENT_ID,
      eventTitle: EVENT_TITLE,
      eventDescription: EVENT_DESCRIPTION,
      eventIcon: null,
      eventResolutionPolicy: "exclusive_first_hit",
      eventChildLabel: child.label,
      marketEnvironment: "test",
      title: buildTitle(child),
      description:
        "שוק בדיקה ל-event-mode: ילד בינארי בלעדי בתוך אירוע חודשי של בחירות בישראל.",
      categoryKey: CATEGORY_KEY,
      openAt: new Date(Date.now() - 5 * 60_000).toISOString(),
      closeAt: child.closeAt,
      resolutionSource: `${SOURCE_LABEL}: ${SOURCE_URL}`,
      resolutionRules: `כן אם הבחירות לכנסת בישראל יתקיימו במהלך ${child.monthName} 2026. אחרת לא.`,
      oracleSourcePolicy: {
        preferredSourceIds: ["src_knesset_elections"],
        contextSourceIds: ["src_knesset_elections"],
        resolutionSourceIds: ["src_knesset_elections"],
        closeConditionSourceIds: [],
        requiresHumanReviewOnSourceConflict: true,
        requiresHumanReviewOnWeakAuthority: true,
        notes: [
          `event-id=${EVENT_ID}`,
          `event-child-label=${child.label}`,
          "exclusive month-bucket election fixture for event-mode front contract"
        ]
      },
      marketContract: buildContract(child),
      liquidityB: LIQUIDITY_B,
      closeOnEventCompletion: false,
      eventCompletionCloseRequiresHumanApproval: false,
      outcomes: [
        {
          outcomeId: outcomeId(child, "yes"),
          label: "כן",
          shortLabel: "כן",
          description: "בחירות התקיימו במהלך החודש הנמדד.",
          colorKey: "green"
        },
        {
          outcomeId: outcomeId(child, "no"),
          label: "לא",
          shortLabel: "לא",
          description: "בחירות לא התקיימו במהלך החודש הנמדד.",
          colorKey: "red"
        }
      ],
      idempotencyKey: `event-election-ladder:create:${id}`
    },
    ACTOR
  );

  return "draft";
}

async function publishIfNeeded(pool: Pool, child: ElectionChild, status: ExistingMarketRow["status"]) {
  if (status !== "draft") {
    return status;
  }

  await publishMarket(
    pool,
    marketId(child),
    {
      seedAmount: SEED_AMOUNT,
      publishAt: new Date().toISOString(),
      note: "Seed event-mode Israel election ladder fixture.",
      reviewId: `event-election-ladder:${marketId(child)}`,
      checklistVersion: "event-election-ladder-v1",
      managementApprovedAt: new Date().toISOString(),
      idempotencyKey: `event-election-ladder:publish:${marketId(child)}`
    },
    ACTOR
  );

  return "open";
}

async function seedTradesIfRequested(pool: Pool, child: ElectionChild, args: string[]): Promise<void> {
  if (readFlag(args, "--trades") === "false") {
    return;
  }

  const env = loadAppEnv();

  await executeTrade(
    pool,
    env,
    marketId(child),
    {
      side: "buy",
      outcomeKey: outcomeId(child, "yes"),
      contractSide: "yes",
      cashAmount: child.yesTradeAmount,
      idempotencyKey: `event-election-ladder:trade:${marketId(child)}:yes`
    },
    TRADE_ACTOR
  );

  await executeTrade(
    pool,
    env,
    marketId(child),
    {
      side: "buy",
      outcomeKey: outcomeId(child, "no"),
      contractSide: "no",
      cashAmount: child.noTradeAmount,
      idempotencyKey: `event-election-ladder:trade:${marketId(child)}:no`
    },
    TRADE_ACTOR
  );
}

async function readPayloadReceipt(pool: Pool, selectedMarketId: string) {
  const result = await pool.query(
    `
      select
        e.id as event_id,
        e.title as event_title,
        e.status as event_status,
        e.resolution_policy,
        count(distinct m.id)::int as child_count,
        array_agg(m.event_child_label order by m.close_at asc) as child_labels
      from events e
      join markets m
        on m.event_id = e.id
      where e.id = $1
        and m.published_at is not null
      group by e.id, e.title, e.status, e.resolution_policy
    `,
    [EVENT_ID]
  );

  return {
    selectedMarketId,
    event: result.rows[0] ?? null
  };
}

async function main() {
  const env = loadAppEnv();
  const pool = createDbPool(env.db);

  try {
    const selected = readFlag(process.argv, "--selected") ?? marketId(CHILDREN[0]!);
    const published: string[] = [];

    for (const child of CHILDREN) {
      const draftStatus = await createDraftIfNeeded(pool, child);
      const finalStatus = await publishIfNeeded(pool, child, draftStatus);
      if (finalStatus === "open") {
        published.push(marketId(child));
      }
      await seedTradesIfRequested(pool, child, process.argv);
    }

    const receipt = await readPayloadReceipt(pool, selected);
    const output = {
      objectType: "event_election_ladder_seed_result",
      eventId: EVENT_ID,
      eventTitle: EVENT_TITLE,
      selectedMarketId: selected,
      marketDetailApiPath: `/api/market-detail/markets/${selected}`,
      childMarketIds: CHILDREN.map(marketId),
      publishedMarketIds: published,
      tradesSeeded: readFlag(process.argv, "--trades") !== "false",
      receipt
    };

    if (hasFlag(process.argv, "--json")) {
      console.log(JSON.stringify(output, null, 2));
    } else {
      console.log(`Seeded event ${EVENT_ID}`);
      console.log(`Selected market: ${selected}`);
      console.log(`Market detail API: ${output.marketDetailApiPath}`);
      console.log(`Children: ${CHILDREN.length}`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
