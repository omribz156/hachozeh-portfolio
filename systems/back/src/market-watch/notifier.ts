export type MarketWatchSignalNotification = {
  kind?: "watch_signal" | "market_case_ready";
  planId: string;
  summary: string;
  sourceUrl: string | null;
  suggestedHumanPrompt: string;
};

export type MarketWatchNotifier = {
  channel: string;
  send: (signal: MarketWatchSignalNotification) => Promise<void>;
};

export function buildMarketWatchMessage(signal: MarketWatchSignalNotification): string {
  return [
    signal.kind === "market_case_ready"
      ? "Hachozeh: market case ready"
      : "Hachozeh: market watch ping",
    signal.summary,
    `Plan: ${signal.planId}`,
    ...(signal.sourceUrl ? [`Source: ${signal.sourceUrl}`] : []),
    "",
    `Paste to Codex: ${signal.suggestedHumanPrompt}`
  ].join("\n");
}

export function createStdoutMarketWatchNotifier(): MarketWatchNotifier {
  return {
    channel: "stdout",
    async send(signal) {
      console.error(buildMarketWatchMessage(signal));
    }
  };
}

export function createTelegramMarketWatchNotifier(input: {
  botToken: string;
  chatId: string;
}): MarketWatchNotifier {
  return {
    channel: "telegram",
    async send(signal) {
      const response = await fetch(
        `https://api.telegram.org/bot${input.botToken}/sendMessage`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            chat_id: input.chatId,
            text: buildMarketWatchMessage(signal),
            disable_web_page_preview: true
          })
        }
      );

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new Error(`Market watch Telegram ping failed: ${response.status} ${body}`.trim());
      }
    }
  };
}

export function createMarketWatchNotifierFromEnv(env: NodeJS.ProcessEnv = process.env): MarketWatchNotifier | null {
  const channel = env.MARKET_WATCH_NOTIFICATION_CHANNEL?.trim().toLowerCase();

  if (channel === "stdout") {
    return createStdoutMarketWatchNotifier();
  }

  if (channel === "none") {
    return null;
  }

  const botToken =
    env.MARKET_WATCH_TELEGRAM_BOT_TOKEN ??
    env.ORACLE_TELEGRAM_BOT_TOKEN ??
    env.TELEGRAM_BOT_TOKEN;
  const chatId =
    env.MARKET_WATCH_TELEGRAM_CHAT_ID ??
    env.ORACLE_TELEGRAM_CHAT_ID ??
    env.TELEGRAM_CHAT_ID;

  if (botToken && chatId) {
    return createTelegramMarketWatchNotifier({ botToken, chatId });
  }

  return null;
}
