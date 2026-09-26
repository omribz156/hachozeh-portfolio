import type { Queryable } from "../../db/client/pool";
import { STARTER_GRANT_AMOUNT } from "../../economy/economy-config";
import { transferPlatformTreasuryToUser } from "../../economy/economy-ledger";

export async function grantStarterBonus(
  db: Queryable,
  userId: string,
  cashAccountId: string
): Promise<void> {
  // Keep grant writes in the same lock order as soak grants: ledger sequence first,
  // then account rows. Reversing this order caused deadlocks under auth stampedes.
  await transferPlatformTreasuryToUser(db, {
    userId,
    userCashAccountId: cashAccountId,
    amount: STARTER_GRANT_AMOUNT,
    referenceType: "grant",
    referenceId: `starter_bonus:${userId}`,
    createdBy: "auth_session_v1",
    triggeredBy: "system"
  });
}
