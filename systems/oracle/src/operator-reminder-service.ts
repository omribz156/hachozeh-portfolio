import { randomUUID } from "node:crypto";

import type { Queryable } from "../../back/src/platform-surface/oracle";
import type { OracleLifecycleRunResult } from "./lifecycle-run-service";

export type OracleOperatorReminderType =
  | "market_closed"
  | "resolution_case_ready";

export type OracleOperatorReminderCandidate = {
  reminderKey: string;
  reminderType: OracleOperatorReminderType;
  marketId: string;
  marketTitle: string;
  closedAt: string | null;
  oracleCaseId: string | null;
  oracleStatus: "missing_resolution_case" | "resolution_case_recommended";
  suggestedHumanPrompt: string;
  messageText: string;
  payload: Record<string, unknown>;
};

export type OracleOperatorReminderNotifier = {
  channel: string;
  send: (candidate: OracleOperatorReminderCandidate) => Promise<void>;
};

export type OracleOperatorReminderResult = {
  objectType: "oracle_operator_reminder_result";
  generatedAt: string;
  channel: string | null;
  enabled: boolean;
  candidateCount: number;
  sentCount: number;
  skippedExistingCount: number;
  failedCount: number;
  sentReminderKeys: string[];
  failedReminderKeys: string[];
};

type ReminderClaimRow = {
  id: string;
};

const DEFAULT_CLOSED_NOTICE_GRACE_MINUTES = 10;

function coalesceClosedAt(input: { closedAt?: string | null; closeAt?: string | null }): string | null {
  return input.closedAt ?? input.closeAt ?? null;
}

function readClosedNoticeGraceMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.ORACLE_OPERATOR_CLOSED_NOTICE_GRACE_MINUTES?.trim();

  if (!raw) {
    return DEFAULT_CLOSED_NOTICE_GRACE_MINUTES;
  }

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) {
    return DEFAULT_CLOSED_NOTICE_GRACE_MINUTES;
  }

  return value;
}

function formatIsraelTime(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    return null;
  }

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";

  return `${read("day")}/${read("month")}/${read("year")} ${read("hour")}:${read("minute")} Israel`;
}

function buildMissingCaseMessage(input: {
  marketTitle: string;
  marketId: string;
  closedAt: string | null;
  expectedResolutionAt?: string | null;
}): string {
  const closedAt = formatIsraelTime(input.closedAt);
  const expectedResolutionAt = formatIsraelTime(input.expectedResolutionAt ?? null);

  return [
    "Hachozeh: market closed",
    input.marketTitle,
    `ID: ${input.marketId}`,
    ...(closedAt ? [`Closed: ${closedAt}`] : []),
    ...(expectedResolutionAt ? [`Result: expected ${expectedResolutionAt}`] : ["Next: wait for case"])
  ].join("\n");
}

function truncateLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, " ").trim();

  if (singleLine.length <= maxLength) {
    return singleLine;
  }

  return `${singleLine.slice(0, maxLength - 1).trimEnd()}…`;
}

function buildRecommendedCaseMessage(input: {
  marketTitle: string;
  marketId: string;
  oracleCaseId: string;
  winningOutcomeLabel: string | null;
  evidenceSummary: string | null;
}): string {
  return [
    "Hachozeh: market case ready",
    input.marketTitle,
    `ID: ${input.marketId}`,
    `Case: ${input.oracleCaseId}`,
    ...(input.winningOutcomeLabel ? [`Outcome: ${input.winningOutcomeLabel}`] : []),
    ...(input.evidenceSummary ? [`Evidence: ${truncateLine(input.evidenceSummary, 160)}`] : []),
    "",
    "Paste to Codex: review this resolution case"
  ].join("\n");
}

function shouldSendClosedNotice(input: {
  ageHours: number | null;
  closedNoticeGraceMinutes: number;
  expectedResolutionAt?: string | null;
  lifecycleFit?: string | null;
  now: Date;
}): boolean {
  if (
    input.lifecycleFit === "scheduled_measurement" &&
    input.expectedResolutionAt &&
    Date.parse(input.expectedResolutionAt) > input.now.getTime()
  ) {
    return false;
  }

  if (input.ageHours === null) {
    return true;
  }

  return input.ageHours * 60 >= input.closedNoticeGraceMinutes;
}

export function buildOracleOperatorReminderCandidates(
  lifecycleRun: OracleLifecycleRunResult,
  options?: {
    closedNoticeGraceMinutes?: number;
    now?: Date;
  }
): OracleOperatorReminderCandidate[] {
  const closedNoticeGraceMinutes = options?.closedNoticeGraceMinutes ?? 0;
  const now = options?.now ?? new Date();
  const missingCaseCandidates = lifecycleRun.phases.inbox.missingCases
    .filter((item) => shouldSendClosedNotice({
      ageHours: item.ageHours,
      closedNoticeGraceMinutes,
      expectedResolutionAt: item.expectedResolutionAt,
      lifecycleFit: item.lifecycleFit,
      now
    }))
    .map((item) => {
      const closedAt = coalesceClosedAt(item);
      const reminderKey = [
        "market-closed",
        item.marketId,
        closedAt ?? "unknown"
      ].join(":");
      const suggestedHumanPrompt = `check closed market ${item.marketId}`;

      return {
        reminderKey,
        reminderType: "market_closed" as const,
        marketId: item.marketId,
        marketTitle: item.marketTitle,
        closedAt,
        oracleCaseId: null,
        oracleStatus: "missing_resolution_case" as const,
        suggestedHumanPrompt,
        messageText: buildMissingCaseMessage({
          marketTitle: item.marketTitle,
          marketId: item.marketId,
          closedAt,
          expectedResolutionAt: item.expectedResolutionAt
        }),
        payload: {
          item,
          suggestedHumanPrompt
        }
      };
    });

  const recommendedCaseCandidates = lifecycleRun.phases.inbox.recommendedCases.map((item) => {
    const reminderKey = [
      "market-case-ready",
      item.oracleCaseId
    ].join(":");
    const suggestedHumanPrompt = `review resolution case ${item.oracleCaseId}`;

    return {
      reminderKey,
      reminderType: "resolution_case_ready" as const,
      marketId: item.marketId,
      marketTitle: item.marketTitle,
      closedAt: null,
      oracleCaseId: item.oracleCaseId,
      oracleStatus: "resolution_case_recommended" as const,
      suggestedHumanPrompt,
      messageText: buildRecommendedCaseMessage({
        marketTitle: item.marketTitle,
        marketId: item.marketId,
        oracleCaseId: item.oracleCaseId,
        winningOutcomeLabel: item.winningOutcomeLabel,
        evidenceSummary: item.evidenceSummary
      }),
      payload: {
        item,
        suggestedHumanPrompt
      }
    };
  });

  return [...missingCaseCandidates, ...recommendedCaseCandidates];
}

async function claimReminder(
  db: Queryable,
  candidate: OracleOperatorReminderCandidate,
  generatedAt: string,
  channel: string
): Promise<string | null> {
  const result = await db.query<ReminderClaimRow>(
    `
      insert into oracle_operator_reminders (
        id,
        reminder_key,
        reminder_type,
        market_id,
        oracle_case_id,
        first_seen_at,
        channel,
        payload_snapshot
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      on conflict (reminder_key) do nothing
      returning id
    `,
    [
      `oor_${randomUUID()}`,
      candidate.reminderKey,
      candidate.reminderType,
      candidate.marketId,
      candidate.oracleCaseId,
      generatedAt,
      channel,
      JSON.stringify({
        messageText: candidate.messageText,
        oracleStatus: candidate.oracleStatus,
        ...candidate.payload
      })
    ]
  );

  return result.rows[0]?.id ?? null;
}

async function markReminderSent(
  db: Queryable,
  reminderId: string,
  sentAt: string
): Promise<void> {
  await db.query(
    `
      update oracle_operator_reminders
      set delivery_status = 'sent',
          sent_at = $2,
          last_attempt_at = $2,
          attempt_count = attempt_count + 1,
          delivery_error = null,
          updated_at = now()
      where id = $1
    `,
    [reminderId, sentAt]
  );
}

async function markReminderFailed(
  db: Queryable,
  reminderId: string,
  failedAt: string,
  error: unknown
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);

  await db.query(
    `
      update oracle_operator_reminders
      set delivery_status = 'failed',
          last_attempt_at = $2,
          attempt_count = attempt_count + 1,
          delivery_error = $3,
          updated_at = now()
      where id = $1
    `,
    [reminderId, failedAt, message.slice(0, 1000)]
  );
}

export async function sendOracleOperatorReminders(
  db: Queryable,
  input: {
    lifecycleRun: OracleLifecycleRunResult;
    notifier: OracleOperatorReminderNotifier | null;
    generatedAt?: string;
  }
): Promise<OracleOperatorReminderResult> {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const generatedAtDate = new Date(generatedAt);
  const candidates = buildOracleOperatorReminderCandidates(input.lifecycleRun, {
    closedNoticeGraceMinutes: readClosedNoticeGraceMinutes(),
    now: Number.isFinite(generatedAtDate.getTime()) ? generatedAtDate : new Date()
  });

  if (!input.notifier) {
    return {
      objectType: "oracle_operator_reminder_result",
      generatedAt,
      channel: null,
      enabled: false,
      candidateCount: candidates.length,
      sentCount: 0,
      skippedExistingCount: candidates.length,
      failedCount: 0,
      sentReminderKeys: [],
      failedReminderKeys: []
    };
  }

  const sentReminderKeys: string[] = [];
  const failedReminderKeys: string[] = [];
  let skippedExistingCount = 0;

  for (const candidate of candidates) {
    const reminderId = await claimReminder(db, candidate, generatedAt, input.notifier.channel);

    if (!reminderId) {
      skippedExistingCount += 1;
      continue;
    }

    try {
      await input.notifier.send(candidate);
      await markReminderSent(db, reminderId, generatedAt);
      sentReminderKeys.push(candidate.reminderKey);
    } catch (error) {
      await markReminderFailed(db, reminderId, generatedAt, error);
      failedReminderKeys.push(candidate.reminderKey);
    }
  }

  return {
    objectType: "oracle_operator_reminder_result",
    generatedAt,
    channel: input.notifier.channel,
    enabled: true,
    candidateCount: candidates.length,
    sentCount: sentReminderKeys.length,
    skippedExistingCount,
    failedCount: failedReminderKeys.length,
    sentReminderKeys,
    failedReminderKeys
  };
}

export function createStdoutOracleOperatorReminderNotifier(): OracleOperatorReminderNotifier {
  return {
    channel: "stdout",
    async send(candidate) {
      console.error(candidate.messageText);
    }
  };
}

export function createTelegramOracleOperatorReminderNotifier(input: {
  botToken: string;
  chatId: string;
}): OracleOperatorReminderNotifier {
  return {
    channel: "telegram",
    async send(candidate) {
      const response = await fetch(
        `https://api.telegram.org/bot${input.botToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            chat_id: input.chatId,
            text: candidate.messageText,
            disable_web_page_preview: true
          })
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Telegram reminder failed: ${response.status} ${body}`.trim());
      }
    }
  };
}

export function createOracleOperatorReminderNotifierFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OracleOperatorReminderNotifier | null {
  const channel = env.ORACLE_OPERATOR_REMINDER_CHANNEL?.trim().toLowerCase();

  if (channel === "stdout") {
    return createStdoutOracleOperatorReminderNotifier();
  }

  const botToken = env.ORACLE_TELEGRAM_BOT_TOKEN ?? env.TELEGRAM_BOT_TOKEN;
  const chatId = env.ORACLE_TELEGRAM_CHAT_ID ?? env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    return createTelegramOracleOperatorReminderNotifier({
      botToken,
      chatId
    });
  }

  return null;
}

export function shouldRunOracleOperatorReminders(
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return env.ORACLE_OPERATOR_REMINDERS_ENABLED === "1";
}
