import { randomUUID } from "node:crypto";

import type { Queryable } from "../../db/client/pool";

// The signup UI presents a single browse-wrap notice ("by continuing you agree to the Terms and
// Privacy Policy and confirm you are 18"). We record acceptance as ONE ROW PER DOCUMENT so the
// stored record is per-purpose/unbundled even though the UI bundles the click — this is the
// stronger consent posture under Israel's consent-only privacy regime (Amendment 13) and makes
// the Terms enforceable with a real, timestamped, versioned acceptance record.
const CONSENT_POLICY_VERSION = "2026-06-draft-v0.2";

const CONSENT_DOCUMENTS = ["terms", "privacy", "age_18"] as const;
export type ConsentDocument = (typeof CONSENT_DOCUMENTS)[number];

export type ConsentSource = "signup" | "reaccept";

// Records acceptance of every required document at account creation. Runs inside the same
// transaction as user creation, so a failure to record consent rolls back the whole signup.
export async function recordSignupConsent(
  db: Queryable,
  userId: string,
  source: ConsentSource = "signup"
): Promise<void> {
  for (const document of CONSENT_DOCUMENTS) {
    await db.query(
      `
        insert into user_consents (id, user_id, document, version, source)
        values ($1, $2, $3, $4, $5)
        on conflict (user_id, document, version) do nothing
      `,
      [`consent_${randomUUID()}`, userId, document, CONSENT_POLICY_VERSION, source]
    );
  }
}
