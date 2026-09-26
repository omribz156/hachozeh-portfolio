const baseUrl = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
const identifier =
  process.env.AUTH_SMOKE_IDENTIFIER ?? `auth-smoke+${Date.now()}@navi.local`;
const configuredMarketKey = process.env.AUTH_SMOKE_MARKET_KEY;
const configuredOutcomeKey = process.env.AUTH_SMOKE_OUTCOME_KEY;

type SessionPayload = {
  actor: {
    userId: string;
    mode: "session";
  } | null;
  session: {
    authenticated: boolean;
    expiresAt: string | null;
  };
};

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  expect(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is not an object.`);

  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), `${label} is not an array.`);

  return value as unknown[];
}

async function readSmokeMarket(): Promise<{
  marketKey: string;
  outcomeKey: string;
}> {
  if (configuredMarketKey && configuredOutcomeKey) {
    return {
      marketKey: configuredMarketKey,
      outcomeKey: configuredOutcomeKey
    };
  }

  const catalogResponse = await fetch(`${baseUrl}/api/markets?status=open&limit=10`);
  const catalog = expectObject(await readJson(catalogResponse), "open market catalog");

  expect(catalogResponse.ok, `Open market catalog failed with ${catalogResponse.status}.`);

  const markets = expectArray(catalog.markets, "catalog.markets");

  for (const item of markets) {
    const marketRecord = expectObject(item, "catalog market");
    const candidateMarketKey = marketRecord.marketKey;

    if (typeof candidateMarketKey !== "string" || candidateMarketKey.length === 0) {
      continue;
    }

    if (configuredMarketKey && candidateMarketKey !== configuredMarketKey) {
      continue;
    }

    const detailResponse = await fetch(`${baseUrl}/api/markets/${encodeURIComponent(candidateMarketKey)}`);
    const detailPayload = expectObject(await readJson(detailResponse), "market detail payload");

    expect(detailResponse.ok, `Market detail failed for ${candidateMarketKey}.`);

    const detailMarket = expectObject(detailPayload.market, "market detail");
    const outcomes = expectArray(detailMarket.outcomes, "market.outcomes");
    const firstOutcome = expectObject(outcomes[0], "market.outcomes[0]");
    const candidateOutcomeKey = configuredOutcomeKey ?? firstOutcome.outcomeKey;

    if (typeof candidateOutcomeKey === "string" && candidateOutcomeKey.length > 0) {
      return {
        marketKey: candidateMarketKey,
        outcomeKey: candidateOutcomeKey
      };
    }
  }

  throw new Error(
    configuredMarketKey
      ? `No open smoke market/outcome found for ${configuredMarketKey}.`
      : "No open smoke market with outcomes found. Set AUTH_SMOKE_MARKET_KEY/AUTH_SMOKE_OUTCOME_KEY to override."
  );
}

function readSetCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie");

  if (!setCookie) {
    throw new Error("Expected Set-Cookie header.");
  }

  return setCookie;
}

function readCookiePair(setCookie: string): string {
  return setCookie.split(";")[0] ?? "";
}

async function run(): Promise<void> {
  const { marketKey, outcomeKey } = await readSmokeMarket();

  const startResponse = await fetch(`${baseUrl}/api/auth/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      identifier,
      purpose: "login"
    })
  });
  const startPayload = await readJson(startResponse) as {
    challengeId: string;
    devCode?: string;
  };

  expect(startResponse.ok, "Auth start failed.");
  expect(Boolean(startPayload.challengeId), "Auth start missing challengeId.");
  expect(Boolean(startPayload.devCode), "Auth start missing devCode.");

  const verifyResponse = await fetch(`${baseUrl}/api/auth/verify`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      challengeId: startPayload.challengeId,
      code: startPayload.devCode
    })
  });
  const verifyPayload = await readJson(verifyResponse) as SessionPayload;
  const cookiePair = readCookiePair(readSetCookie(verifyResponse));

  expect(verifyResponse.ok, "Auth verify failed.");
  expect(verifyPayload.session.authenticated, "Verify did not authenticate session.");
  expect(verifyPayload.actor?.mode === "session", "Verify did not return session actor.");

  const sessionResponse = await fetch(`${baseUrl}/api/session`, {
    headers: {
      cookie: cookiePair
    }
  });
  const sessionPayload = await readJson(sessionResponse) as SessionPayload;

  expect(sessionResponse.ok, "Session read failed.");
  expect(sessionPayload.session.authenticated, "Session read did not stay authenticated.");
  expect(sessionPayload.actor?.userId === verifyPayload.actor?.userId, "Session actor drifted.");

  const quoteResponse = await fetch(`${baseUrl}/api/markets/${marketKey}/quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookiePair
    },
    body: JSON.stringify({
      side: "buy",
      outcomeKey,
      cashAmount: "1.000000"
    })
  });
  const quotePayload = await readJson(quoteResponse);

  expect(quoteResponse.ok, `Authenticated quote failed: ${JSON.stringify(quotePayload)}`);

  const logoutResponse = await fetch(`${baseUrl}/api/auth/logout`, {
    method: "POST",
    headers: {
      cookie: cookiePair
    }
  });
  const logoutPayload = await readJson(logoutResponse) as SessionPayload;

  expect(logoutResponse.ok, "Logout failed.");
  expect(!logoutPayload.session.authenticated, "Logout did not clear auth.");

  const postLogoutQuoteResponse = await fetch(`${baseUrl}/api/markets/${marketKey}/quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookiePair
    },
    body: JSON.stringify({
      side: "buy",
      outcomeKey,
      cashAmount: "1.000000"
    })
  });
  const postLogoutQuotePayload = await readJson(postLogoutQuoteResponse) as {
    error?: {
      code?: string;
    };
  };

  expect(postLogoutQuoteResponse.status === 401, "Post-logout quote should be unauthorized.");
  expect(
    postLogoutQuotePayload.error?.code === "unauthorized",
    "Post-logout quote did not return unauthorized."
  );

  console.log(
    JSON.stringify({
      start: startResponse.status,
      verify: verifyResponse.status,
      session: sessionResponse.status,
      quote: quoteResponse.status,
      logout: logoutResponse.status,
      postLogoutQuote: postLogoutQuoteResponse.status,
      marketKey,
      outcomeKey
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
