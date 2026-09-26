import { randomUUID } from "node:crypto";

import type { Queryable } from "../../db/client/pool";
import { buildDefaultPublicHandle } from "../../shared/public-user-identity";
import { recordSignupConsent } from "./consent-records";
import type { UserIdentityRow, UserIdentityType } from "./types";

export async function readIdentityByTypeIdentifier(
  db: Queryable,
  type: UserIdentityType,
  identifier: string
): Promise<UserIdentityRow | null> {
  const result = await db.query<UserIdentityRow>(
    `
      select
        ui.id as identity_id,
        ui.user_id,
        u.status as user_status
      from user_identities ui
      join users u
        on u.id = ui.user_id
      where ui.type = $1
        and ui.identifier_normalized = $2
        and ui.status = 'active'
      limit 1
    `,
    [type, identifier]
  );

  return result.rows[0] ?? null;
}

export async function readIdentityByIdentifier(
  db: Queryable,
  identifier: string
): Promise<UserIdentityRow | null> {
  return readIdentityByTypeIdentifier(db, "email", identifier);
}

export async function readGoogleIdentitiesByDisplayEmail(
  db: Queryable,
  identifier: string
): Promise<UserIdentityRow[]> {
  const result = await db.query<UserIdentityRow>(
    `
      select
        ui.id as identity_id,
        ui.user_id,
        u.status as user_status
      from user_identities ui
      join users u
        on u.id = ui.user_id
      where ui.type = 'google'
        and lower(ui.identifier_display) = $1
        and ui.status = 'active'
      order by ui.created_at asc
    `,
    [identifier]
  );

  return result.rows;
}

export async function insertUserIdentity(
  db: Queryable,
  input: {
    userId: string;
    type: UserIdentityType;
    identifierNormalized: string;
    identifierDisplay: string;
  }
): Promise<void> {
  const identityId = `identity_${randomUUID()}`;

  await db.query(
    `
      insert into user_identities (
        id,
        user_id,
        type,
        identifier_normalized,
        identifier_display,
        status,
        verified_at
      )
      values ($1, $2, $3, $4, $5, 'active', now())
    `,
    [
      identityId,
      input.userId,
      input.type,
      input.identifierNormalized,
      input.identifierDisplay
    ]
  );
}

export async function createUserWithIdentity(
  db: Queryable,
  identity:
    | string
    | {
        type: UserIdentityType;
        identifierNormalized: string;
        identifierDisplay: string;
      }
): Promise<{ userId: string; cashAccountId: string }> {
  const userId = `user_${randomUUID()}`;
  const accountId = `account_${userId}_cash`;
  const identityInput =
    typeof identity === "string"
      ? {
          type: "email" as const,
          identifierNormalized: identity,
          identifierDisplay: identity
        }
      : identity;

  const handle = buildDefaultPublicHandle(userId);

  await db.query(
    `
      insert into users (id, handle, status, role, trade_access_status)
      values ($1, $2, 'active', 'user', 'enabled')
    `,
    [userId, handle]
  );

  await insertUserIdentity(db, {
    userId,
    type: identityInput.type,
    identifierNormalized: identityInput.identifierNormalized,
    identifierDisplay: identityInput.identifierDisplay
  });

  await db.query(
    `
      insert into accounts (id, type, owner_id, status, balance_cached)
      values ($1, 'user_cash', $2, 'active', '0.000000')
    `,
    [accountId, userId]
  );

  // Stamp a per-document acceptance record (Terms, Privacy, 18+) at account creation. Both the
  // email-OTP and Google signup paths flow through here, so every new account is covered.
  await recordSignupConsent(db, userId, "signup");

  return {
    userId,
    cashAccountId: accountId
  };
}
