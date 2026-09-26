// Shared presentation helpers for the community surface. These produce the
// display-ready fields the seeded Preact islands already expect (tint slot,
// avatar initial, relative-time label, position chip), so the front renders
// real data unchanged. See workspace/tasks/queued/finish-community-integration.md.

// Product caps (the seed calls these the "backend contract"): the DB CHECKs are
// generous backstops; these are the real limits enforced at the service layer.
export const MAX_DISCUSSION_TITLE = 160;
export const MAX_DISCUSSION_BODY = 280; // MAX_POST in the seed
export const MAX_POST_BODY = 280;

// The island paints avatars from a fixed tint palette (matches community-ui.jsx).
// Assign a stable slot per user so the same author keeps the same color.
const TINTS = ["t-amber", "t-violet", "t-info", "t-mint", "t-rose", "t-cyan"] as const;

export function buildAuthorTint(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 1_000_003;
  }
  return TINTS[hash % TINTS.length];
}

export function initialOf(name: string): string {
  const trimmed = (name || "").trim();
  return trimmed ? trimmed[0] : "ח";
}

export type CommunityPosChip = { side: "buy" | "sell"; label: string };

// A holder's live side on a market → the "מחזיק · כן/לא" chip. contract_side is
// 'yes'|'no'; the island colors it via `side` ('buy' = green/כן, 'sell' = red/לא).
export function posChipFor(contractSide: string): CommunityPosChip {
  return contractSide === "no"
    ? { side: "sell", label: "מחזיק · לא" }
    : { side: "buy", label: "מחזיק · כן" };
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Hebrew relative-time label matching the seed's `time` strings ("עכשיו",
// "לפני 22 ד׳", "לפני שעה", "לפני 3 ש׳", "אתמול", then an absolute date).
export function relativeTimeLabel(date: Date): string {
  const diff = Date.now() - date.getTime();
  if (diff < MINUTE) return "עכשיו";
  if (diff < HOUR) return `לפני ${Math.floor(diff / MINUTE)} ד׳`;
  if (diff < 2 * HOUR) return "לפני שעה";
  if (diff < DAY) return `לפני ${Math.floor(diff / HOUR)} ש׳`;
  if (diff < 2 * DAY) return "אתמול";
  if (diff < 7 * DAY) return `לפני ${Math.floor(diff / DAY)} ימים`;
  return new Intl.DateTimeFormat("he-IL", { day: "numeric", month: "short" }).format(date);
}

// Coarse community topic from a market category label ("ספורט · כדורסל" → "ספורט").
// Kept loose: the prefix is stored denormalized on the discussion for cheap
// topic filtering; markets never change category so it can't drift.
export function topicForCategoryLabel(label: string | null): string | null {
  if (!label) return null;
  const prefix = label.split("·")[0]?.trim() || null;
  return prefix ? prefix.slice(0, 40) : null;
}
