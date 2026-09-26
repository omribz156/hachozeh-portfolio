const baseUrl = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
const marketKey = process.env.MARKET_API_SMOKE_MARKET ?? "next-prime-minister";

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON response, got: ${text.slice(0, 200)}`);
  }
}

async function expectJsonGet(path: string): Promise<unknown> {
  const response = await fetch(`${baseUrl}${path}`);
  const payload = await readJson(response);

  expect(response.ok, `${path} failed with ${response.status}: ${JSON.stringify(payload)}`);

  return payload;
}

async function expectJsonPost(path: string, body: Record<string, unknown>): Promise<{
  payload: Record<string, unknown>;
  status: number;
}> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });
  const payload = expectObject(await readJson(response), `${path} payload`);

  return {
    payload,
    status: response.status
  };
}

function expectObject(value: unknown, label: string): Record<string, unknown> {
  expect(value !== null && typeof value === "object" && !Array.isArray(value), `${label} is not an object.`);

  return value as Record<string, unknown>;
}

function expectArray(value: unknown, label: string): unknown[] {
  expect(Array.isArray(value), `${label} is not an array.`);

  return value as unknown[];
}

function readFirstOutcomeKey(marketRecord: Record<string, unknown>): string {
  const outcomes = expectArray(marketRecord.outcomes, "market.outcomes");
  const [firstOutcome] = outcomes;
  const outcome = expectObject(firstOutcome, "market.outcomes[0]");
  const outcomeKey = outcome.outcomeKey;

  if (typeof outcomeKey !== "string" || outcomeKey.length === 0) {
    throw new Error("market first outcome key is missing.");
  }

  return outcomeKey;
}

async function expectClosedTradingGate(
  marketKey: string,
  outcomeKey: string
): Promise<string> {
  const quoteResult = await expectJsonPost(`/api/markets/${marketKey}/quote`, {
    side: "buy",
    contractSide: "yes",
    outcomeKey,
    cashAmount: "1.00"
  });

  // Unauthenticated requests are rejected before the market-state guard when
  // the demo actor is off — that 401 is correct posture, not a gate failure.
  // The 409 market_not_open assertion needs an actor to be reachable.
  if (quoteResult.status === 401) {
    return "skipped_unauthenticated (enable DEMO_ACTOR_MODE_ENABLED or run with a session to assert the 409 gate)";
  }

  expect(quoteResult.status === 409, "closed market quote did not return 409.");
  expect(
    expectObject(quoteResult.payload.error, "quote error").code === "market_not_open",
    "closed market quote did not return market_not_open."
  );

  const tradeResult = await expectJsonPost(`/api/markets/${marketKey}/trades`, {
    side: "buy",
    contractSide: "yes",
    outcomeKey,
    cashAmount: "1.00",
    idempotencyKey: `smoke:closed:${marketKey}:${Date.now()}`
  });

  expect(tradeResult.status === 409, "closed market trade did not return 409.");
  expect(
    expectObject(tradeResult.payload.error, "trade error").code === "market_not_open",
    "closed market trade did not return market_not_open."
  );

  return "ok";
}

async function run(): Promise<void> {
  const catalog = expectObject(
    await expectJsonGet("/api/markets?status=all&limit=5"),
    "catalog payload"
  );
  expectArray(catalog.markets, "catalog.markets");

  const market = expectObject(await expectJsonGet(`/api/markets/${marketKey}`), "market payload");
  const marketRecord = expectObject(market.market, "market.market");
  expect(marketRecord.marketKey === marketKey, "market detail key drifted.");
  const firstOutcomeKey = readFirstOutcomeKey(marketRecord);
  const shouldCheckClosedTradingGate = marketRecord.marketStatus !== "open";

  const closedTradingGateStatus = shouldCheckClosedTradingGate
    ? await expectClosedTradingGate(marketKey, firstOutcomeKey)
    : "skipped_open_market";

  const prices = expectObject(await expectJsonGet(`/api/markets/${marketKey}/prices`), "prices payload");
  expectArray(prices.prices, "prices.prices");

  const trades = expectObject(
    await expectJsonGet(`/api/markets/${marketKey}/trades?limit=5`),
    "trades payload"
  );
  expectArray(trades.trades, "trades.trades");

  const positions = expectObject(
    await expectJsonGet(`/api/markets/${marketKey}/positions?limit=5`),
    "positions payload"
  );
  expectObject(positions.holdersByOutcome, "positions.holdersByOutcome");
  expectObject(positions.positionsByOutcome, "positions.positionsByOutcome");

  const history = expectObject(
    await expectJsonGet(`/api/markets/${marketKey}/price-history?range=all`),
    "price-history payload"
  );
  expectArray(history.points, "price-history.points");

  const reusableHistory = expectObject(
    await expectJsonGet(`/api/markets/${marketKey}/history?range=1D`),
    "history payload"
  );
  expectArray(reusableHistory.points, "history.points");
  expectArray(reusableHistory.outcomes, "history.outcomes");
  expect(
    Number.isFinite(Number(reusableHistory.resolutionSeconds)),
    "history.resolutionSeconds is missing."
  );

  const marketDetail = expectObject(
    await expectJsonGet(`/api/market-detail/markets/${marketKey}`),
    "market-detail payload"
  );
  const snapshot = expectObject(marketDetail.snapshot, "market-detail.snapshot");
  expectArray(snapshot.outcomes, "market-detail.snapshot.outcomes");
  const eventUpdates =
    snapshot.eventUpdates === undefined
      ? []
      : expectArray(snapshot.eventUpdates, "market-detail.snapshot.eventUpdates");

  const streamResponse = await fetch(`${baseUrl}/api/markets/${marketKey}/stream?once=1`);
  const streamBody = await streamResponse.text();

  expect(streamResponse.ok, `stream failed with ${streamResponse.status}: ${streamBody}`);
  expect(
    streamResponse.headers.get("content-type")?.includes("text/event-stream") === true,
    "stream did not return text/event-stream."
  );
  expect(streamBody.includes("event: market.snapshot"), "stream missing market.snapshot event.");

  console.log(
    JSON.stringify({
      catalog: "ok",
      market: marketKey,
      prices: "ok",
      trades: "ok",
      positions: "ok",
      priceHistory: "ok",
      history: "ok",
      marketDetail: "ok",
      eventUpdates: eventUpdates.length,
      stream: "ok",
      closedTradingGate: closedTradingGateStatus
    })
  );
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

export {};
