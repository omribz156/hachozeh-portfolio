import { randomUUID } from "node:crypto";

const baseUrl = process.env.BACKEND_BASE_URL ?? "http://127.0.0.1:3001";
const adminIdentifier = process.env.ADMIN_SMOKE_IDENTIFIER ?? "seed-admin@navi.local";
const targetUserId = process.env.ADMIN_SMOKE_TARGET_USER_ID ?? "seed_user_1";
const configuredMarketKey = process.env.ADMIN_SMOKE_MARKET_KEY;
const configuredOutcomeKey = process.env.ADMIN_SMOKE_OUTCOME_KEY;

// Quote legs need an OPEN market — a hardcoded default rots as markets close
// (same resolver shape as smoke-auth-session).
let marketKey = configuredMarketKey ?? "";
let outcomeKey = configuredOutcomeKey ?? "";

async function resolveSmokeMarket(): Promise<void> {
  if (configuredMarketKey && configuredOutcomeKey) {
    return;
  }

  const catalogResponse = await fetch(`${baseUrl}/api/markets?status=open&limit=10`);
  const catalog = await readJson(catalogResponse) as { markets?: Array<{ marketKey?: string }> };
  expect(catalogResponse.ok, `Open market catalog failed with ${catalogResponse.status}.`);

  for (const item of catalog.markets ?? []) {
    const candidateMarketKey = item?.marketKey;

    if (typeof candidateMarketKey !== "string" || candidateMarketKey.length === 0) {
      continue;
    }

    if (configuredMarketKey && candidateMarketKey !== configuredMarketKey) {
      continue;
    }

    const detailResponse = await fetch(`${baseUrl}/api/markets/${encodeURIComponent(candidateMarketKey)}`);
    const detailPayload = await readJson(detailResponse) as {
      market?: { outcomes?: Array<{ outcomeKey?: string }> };
    };
    expect(detailResponse.ok, `Market detail failed for ${candidateMarketKey}.`);

    const candidateOutcomeKey = configuredOutcomeKey ?? detailPayload.market?.outcomes?.[0]?.outcomeKey;

    if (typeof candidateOutcomeKey === "string" && candidateOutcomeKey.length > 0) {
      marketKey = candidateMarketKey;
      outcomeKey = candidateOutcomeKey;
      return;
    }
  }

  throw new Error(
    "No open smoke market with outcomes found. Set ADMIN_SMOKE_MARKET_KEY/ADMIN_SMOKE_OUTCOME_KEY to override."
  );
}

function expect(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function readJson(response: Response): Promise<unknown> {
  return response.json();
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

async function authenticateIdentifier(
  identifier: string,
  purpose: "login" | "signup"
): Promise<{
  cookiePair: string;
  actorUserId: string;
}> {
  const startResponse = await fetch(`${baseUrl}/api/auth/start`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      identifier,
      purpose
    })
  });
  const startPayload = await readJson(startResponse) as {
    challengeId?: string;
    devCode?: string;
  };

  expect(startResponse.ok, `${purpose} auth start failed for ${identifier}.`);
  expect(Boolean(startPayload.challengeId), `${purpose} auth start missing challengeId.`);
  expect(Boolean(startPayload.devCode), `${purpose} auth start missing devCode.`);

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
  const verifyPayload = await readJson(verifyResponse) as {
    actor?: {
      userId?: string;
    } | null;
  };

  expect(verifyResponse.ok, `${purpose} auth verify failed for ${identifier}.`);
  expect(Boolean(verifyPayload.actor?.userId), `${purpose} auth verify missing actor.`);

  return {
    cookiePair: readCookiePair(readSetCookie(verifyResponse)),
    actorUserId: String(verifyPayload.actor?.userId)
  };
}

async function loginAsSeedAdmin(): Promise<string> {
  const session = await authenticateIdentifier(adminIdentifier, "login");
  return session.cookiePair;
}

async function postWithAdminCookie(
  cookiePair: string,
  path: string,
  body: Record<string, unknown> = {}
): Promise<{ status: number; payload: any }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookiePair
    },
    body: JSON.stringify(body)
  });

  return {
    status: response.status,
    payload: await readJson(response)
  };
}

async function assertDemoActorAvailable(): Promise<void> {
  // The block/restore legs quote as the demo actor without a session. With
  // demo mode off those return 401, not the block-state codes this smoke
  // asserts — fail fast before mutating the target's trade access.
  const probe = await fetch(`${baseUrl}/api/markets/${marketKey}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ side: "buy", outcomeKey, cashAmount: "1.000000" })
  });

  expect(
    probe.status !== 401,
    "Demo actor unavailable (got 401). This smoke requires DEMO_ACTOR_MODE_ENABLED=true on the backend."
  );
}

async function run(): Promise<void> {
  await resolveSmokeMarket();
  await assertDemoActorAvailable();
  const adminCookie = await loginAsSeedAdmin();
  const archiveTargetIdentifier = `admin-archive-smoke+${randomUUID()}@navi.local`;
  const archiveTargetSession = await authenticateIdentifier(archiveTargetIdentifier, "signup");

  const meResponse = await fetch(`${baseUrl}/api/me`, {
    headers: {
      cookie: adminCookie
    }
  });
  const mePayload = await readJson(meResponse) as {
    user?: {
      role?: string;
    };
    capabilities?: {
      canAccessAdmin?: boolean;
    };
  };

  expect(meResponse.ok, "Admin /api/me failed.");
  expect(mePayload.user?.role === "admin", "Seeded admin did not resolve as admin.");
  expect(mePayload.capabilities?.canAccessAdmin === true, "Seeded admin lacks admin capability.");

  const adminUserReadResponse = await fetch(`${baseUrl}/admin/users/${targetUserId}`, {
    headers: {
      cookie: adminCookie
    }
  });
  const adminUserReadPayload = await readJson(adminUserReadResponse) as {
    user?: {
      userId?: string;
      status?: string;
    };
    sessions?: {
      activeCount?: number;
    };
  };

  expect(adminUserReadResponse.ok, "Admin user read failed.");
  expect(adminUserReadPayload.user?.userId === targetUserId, "Admin user read returned wrong user.");
  expect(typeof adminUserReadPayload.sessions?.activeCount === "number", "Admin user read missing session count.");

  const lock = await postWithAdminCookie(adminCookie, `/admin/users/${targetUserId}/lock`, {
    reasonCode: "smoke_lock"
  });
  expect(lock.status === 200, `Admin lock failed: ${JSON.stringify(lock.payload)}`);

  const unlock = await postWithAdminCookie(adminCookie, `/admin/users/${targetUserId}/unlock`);
  expect(unlock.status === 200, `Admin unlock failed: ${JSON.stringify(unlock.payload)}`);

  const block = await postWithAdminCookie(adminCookie, `/admin/users/${targetUserId}/trade-block`, {
    reasonCode: "smoke_trade_block"
  });
  expect(block.status === 200, `Trade block failed: ${JSON.stringify(block.payload)}`);

  const blockedQuoteResponse = await fetch(`${baseUrl}/api/markets/${marketKey}/quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      side: "buy",
      outcomeKey,
      cashAmount: "1.000000"
    })
  });
  const blockedQuotePayload = await readJson(blockedQuoteResponse) as {
    error?: {
      code?: string;
    };
  };

  expect(blockedQuoteResponse.status === 403, "Blocked demo quote should return 403.");
  expect(
    blockedQuotePayload.error?.code === "trade_access_blocked",
    "Blocked demo quote did not return trade_access_blocked."
  );

  const restore = await postWithAdminCookie(adminCookie, `/admin/users/${targetUserId}/trade-restore`);
  expect(restore.status === 200, `Trade restore failed: ${JSON.stringify(restore.payload)}`);

  const restoredQuoteResponse = await fetch(`${baseUrl}/api/markets/${marketKey}/quote`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      side: "buy",
      outcomeKey,
      cashAmount: "1.000000"
    })
  });
  const restoredQuotePayload = await readJson(restoredQuoteResponse);

  expect(
    restoredQuoteResponse.ok,
    `Restored demo quote should succeed: ${JSON.stringify(restoredQuotePayload)}`
  );

  const revoke = await postWithAdminCookie(
    adminCookie,
    `/admin/users/${targetUserId}/sessions/revoke`
  );
  expect(revoke.status === 200, `Session revoke failed: ${JSON.stringify(revoke.payload)}`);

  const archive = await postWithAdminCookie(
    adminCookie,
    `/admin/users/${archiveTargetSession.actorUserId}/archive`,
    {
      reasonCode: "smoke_archive"
    }
  );
  expect(archive.status === 200, `Archive failed: ${JSON.stringify(archive.payload)}`);

  const archivedSessionMeResponse = await fetch(`${baseUrl}/api/me`, {
    headers: {
      cookie: archiveTargetSession.cookiePair
    }
  });
  const archivedSessionMePayload = await readJson(archivedSessionMeResponse) as {
    error?: {
      code?: string;
    };
  };
  expect(
    archivedSessionMeResponse.status === 401 || archivedSessionMeResponse.status === 403,
    `Archived session /api/me should fail: ${JSON.stringify(archivedSessionMePayload)}`
  );
  expect(
    archivedSessionMePayload.error?.code === "unauthorized",
    "Archived session did not return unauthorized."
  );

  console.log(
    JSON.stringify({
      me: meResponse.status,
      adminUserRead: adminUserReadResponse.status,
      lock: lock.status,
      unlock: unlock.status,
      tradeBlock: block.status,
      blockedQuote: blockedQuoteResponse.status,
      tradeRestore: restore.status,
      restoredQuote: restoredQuoteResponse.status,
      revokeSessions: revoke.status,
      archive: archive.status,
      archivedSessionMe: archivedSessionMeResponse.status,
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
