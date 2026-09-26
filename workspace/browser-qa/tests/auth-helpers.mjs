import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const SEEDED_ADMIN_STORAGE_STATE = path.join(
  os.tmpdir(),
  "navi-browser-qa-seed-admin-storage.json"
);

const DEFAULT_OPEN_LIVE_MARKET_CANDIDATES = [
  {
    marketKey: "next-prime-minister",
    outcomeKey: "option-a",
  },
  {
    marketKey: "bank-israel-mar-18",
    outcomeKey: "cut-025",
  },
  {
    marketKey: "disc-cm-boi-rate-decision-july-6-2026-v2",
    outcomeKey: "disc-cm-boi-rate-decision-july-6-2026-cut-025",
  },
  {
    marketKey: "disc-cm-knesset-dissolution-before-may-2026",
    outcomeKey: "disc-cm-knesset-dissolution-before-may-2026-option-1",
  },
];

async function readJson(response) {
  return response.json().catch(() => null);
}

// Discover currently-open markets from the live discovery feed instead of
// trusting the static candidate list above — markets close over time and
// hardcoded keys rot (the BOI July candidate broke portfolio-live on
// 2026-06-11). The static list stays as a last-resort fallback tail.
export async function resolveOpenMarketTargets(context, { backendBase, limit = 8 } = {}) {
  const response = await context.request.get(
    `${backendBase}/api/discovery/feed?limit=${limit}`
  );
  const payload = await readJson(response);
  const openFeedTargets = (payload?.items || [])
    .filter(
      (item) =>
        item?.marketStatus === "open" &&
        Array.isArray(item?.outcomes) &&
        item.outcomes.length > 0 &&
        item.outcomes[0]?.outcomeKey
    )
    .map((item) => ({
      marketKey: item.marketKey,
      outcomeKey: item.outcomes[0].outcomeKey,
    }));

  return openFeedTargets.length > 0
    ? openFeedTargets
    : DEFAULT_OPEN_LIVE_MARKET_CANDIDATES;
}

export async function authenticateContext(
  context,
  { backendBase, identifier, purpose = "login" }
) {
  const startResponse = await context.request.post(`${backendBase}/api/auth/start`, {
    data: {
      identifier,
      purpose,
    },
  });
  const startPayload = await readJson(startResponse);

  if (!startResponse.ok()) {
    throw new Error(
      `Auth start failed for ${identifier}: ${startResponse.status()} ${JSON.stringify(startPayload)}`
    );
  }

  const verifyResponse = await context.request.post(`${backendBase}/api/auth/verify`, {
    data: {
      challengeId: startPayload.challengeId,
      code: startPayload.devCode || "111111",
    },
  });
  const verifyPayload = await readJson(verifyResponse);

  if (!verifyResponse.ok()) {
    throw new Error(
      `Auth verify failed for ${identifier}: ${verifyResponse.status()} ${JSON.stringify(verifyPayload)}`
    );
  }

  return {
    startPayload,
    verifyPayload,
  };
}

export async function ensureStoredSession(
  browser,
  { backendBase, identifier, purpose = "login", storageStatePath }
) {
  try {
    await fs.access(storageStatePath);
    return storageStatePath;
  } catch {}

  const context = await browser.newContext();

  try {
    await authenticateContext(context, {
      backendBase,
      identifier,
      purpose,
    });
    await context.storageState({ path: storageStatePath });
    return storageStatePath;
  } finally {
    await context.close();
  }
}

export async function createPosition(
  context,
  {
    backendBase,
    marketKey = "disc-cm-boi-rate-decision-july-6-2026-v2",
    outcomeKey = "disc-cm-boi-rate-decision-july-6-2026-cut-025",
    contractSide = "yes",
    cashAmount = "20.000000",
  } = {}
) {
  const quoteResponse = await context.request.post(
    `${backendBase}/api/markets/${marketKey}/quote`,
    {
      data: {
        side: "buy",
        outcomeKey,
        contractSide,
        cashAmount,
      },
    }
  );
  const quotePayload = await readJson(quoteResponse);

  if (!quoteResponse.ok()) {
    const error = new Error(
      `Quote failed for ${marketKey}: ${quoteResponse.status()} ${JSON.stringify(quotePayload)}`
    );
    error.status = quoteResponse.status();
    error.code = quotePayload?.error?.code ?? "internal_error";
    error.payload = quotePayload;
    throw error;
  }

  const tradeResponse = await context.request.post(
    `${backendBase}/api/markets/${marketKey}/trades`,
    {
      data: {
        side: "buy",
        outcomeKey,
        contractSide,
        cashAmount,
        idempotencyKey: randomUUID(),
        quoteId: quotePayload.quoteId ?? null,
        quotedAt: quotePayload.quotedAt ?? null,
        quoteExpiresAt: quotePayload.expiresAt ?? null,
        expectedMarketStateVersion: quotePayload.marketStateVersion ?? null,
      },
    }
  );
  const tradePayload = await readJson(tradeResponse);

  if (!tradeResponse.ok()) {
    const error = new Error(
      `Trade failed for ${marketKey}: ${tradeResponse.status()} ${JSON.stringify(tradePayload)}`
    );
    error.status = tradeResponse.status();
    error.code = tradePayload?.error?.code ?? "internal_error";
    error.payload = tradePayload;
    throw error;
  }

  return {
    quotePayload,
    tradePayload,
  };
}

export async function createPositionInOpenSeededMarket(
  context,
  {
    backendBase,
    cashAmount = "20.000000",
    candidates = null,
  } = {}
) {
  const failures = [];
  const resolved =
    candidates ??
    [
      ...(await resolveOpenMarketTargets(context, { backendBase }).catch(() => [])),
      ...DEFAULT_OPEN_LIVE_MARKET_CANDIDATES,
    ];

  for (const candidate of resolved) {
    try {
      const result = await createPosition(context, {
        backendBase,
        marketKey: candidate.marketKey,
        outcomeKey: candidate.outcomeKey,
        cashAmount,
      });

      return {
        marketKey: candidate.marketKey,
        outcomeKey: candidate.outcomeKey,
        ...result,
      };
    } catch (error) {
      if (error?.code === "market_not_open") {
        failures.push(`${candidate.marketKey}:${candidate.outcomeKey}:market_not_open`);
        continue;
      }

      throw error;
    }
  }

  throw new Error(
    `No open live market available for browser exposure setup. Tried ${failures.join(", ")}`
  );
}
