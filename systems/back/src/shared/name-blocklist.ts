// name-blocklist.ts — curated profanity/sexual/slur blocklist for user-chosen
// display names (and reusable for handles or any other free-text identity field).
//
// CURATION RULES
// ---------------
// - `token`: matched only against whole tokens after the name is split on
//   separators (spaces, punctuation, underscores, dots, dashes). Use this tag
//   for any entry that is ALSO a legitimate Hebrew/English word or substring
//   of one — i.e. anything that would produce false positives under naive
//   substring matching.
// - `substring`: matched anywhere in the fully-collapsed (separator-stripped)
//   string. Only use this tag when no innocent word is known to contain the
//   term as a substring. Reserve this for terms that are unambiguous even
//   glued to other characters (most vowel-heavy Hebrew profanity, and latin
//   slurs/profanity after leet-normalization).
//
// THE חזה / החוזה CASE (why this file exists)
// --------------------------------------------
// The platform's own name is "החוזה" ("the seer/forecaster"), and "חזה"
// ("chest/breast", also the root of "forecast") is an ordinary Hebrew root
// that appears inside countless innocent words: מחזה (a play/spectacle),
// חזהו (his chest), תחזה (you will see/forecast), חיזוי (forecasting),
// לחזות (to forecast/watch) — and of course החוזה itself. A prod incident
// showed a user abusing "חזה" in a display name; the naive fix (substring-ban
// "חזה") would also nuke the product's own name and every innocent derivative.
// So "חזה"-class words go in as `token` ONLY: they are blocked when they
// appear as a standalone word (e.g. a name that IS "חזה" or "לחזות" as a
// deliberate innuendo-name), but "החוזה", "מחזה", "תחזה" tokenize as their
// own distinct words and never match. Any future entry with the same shape
// (a real word that is *also* used as an insult/innuendo) must follow the
// same `token`-only rule — never add it as `substring`.
//
// This list is intentionally small and curated, not exhaustive. It targets
// the abuse patterns actually seen (sexual/masturbation references, profanity,
// slurs), not every possible slang variant. Extend deliberately, and default
// new entries to `token` unless you can argue no Hebrew/English word contains
// them.

export type BlocklistMatchMode = "token" | "substring";

export type BlocklistEntry = {
  readonly term: string;
  readonly mode: BlocklistMatchMode;
};

// Terms are stored already normalized (lowercase latin, no niqqud, no
// spacing) — see normalizeForBlocklistMatch() in display-name-guard.ts, which
// all inputs are run through before comparison.
export const DISPLAY_NAME_BLOCKLIST: readonly BlocklistEntry[] = [
  // ── Hebrew: real words abusable as names — חזה-class, token-only ──
  { term: "חזה", mode: "token" }, // the false-positive trap this file exists for; see header
  { term: "לחזות", mode: "token" },
  { term: "תחזה", mode: "token" },
  { term: "חיזוי", mode: "token" },

  // ── Hebrew: sexual / masturbation references ──
  { term: "לאונן", mode: "token" },
  { term: "אונן", mode: "token" },
  { term: "אוננות", mode: "substring" },
  { term: "מאונן", mode: "token" },
  { term: "זין", mode: "token" },
  { term: "זיון", mode: "substring" },
  { term: "כוס", mode: "token" },
  { term: "קוס", mode: "token" },
  { term: "פות", mode: "token" },
  { term: "שרמוטה", mode: "substring" },
  { term: "זונה", mode: "token" },
  { term: "זונות", mode: "substring" },
  { term: "מזדיין", mode: "substring" },
  { term: "מזיין", mode: "substring" },

  // ── Hebrew: general profanity / abuse ──
  { term: "מניאק", mode: "substring" },
  { term: "בן זונה", mode: "substring" },
  { term: "בת זונה", mode: "substring" },
  { term: "חרא", mode: "token" },
  { term: "מפגר", mode: "token" },
  { term: "מטומטם", mode: "substring" },
  { term: "דפוק", mode: "token" },
  { term: "קללה", mode: "token" },

  // ── Hebrew: slurs ──
  { term: "כושי", mode: "substring" },
  { term: "פדופיל", mode: "substring" },

  // ── Latin/English: profanity ──
  { term: "fuck", mode: "substring" },
  { term: "shit", mode: "substring" },
  { term: "bitch", mode: "substring" },
  { term: "asshole", mode: "substring" },
  { term: "cunt", mode: "substring" },
  { term: "dick", mode: "token" },
  { term: "pussy", mode: "substring" },
  { term: "whore", mode: "substring" },
  { term: "slut", mode: "substring" },

  // ── Latin/English: hate / slurs / historical atrocity ──
  { term: "nazi", mode: "substring" },
  { term: "hitler", mode: "substring" },
  { term: "nigger", mode: "substring" },
  { term: "nigga", mode: "substring" },
  { term: "faggot", mode: "substring" },
  { term: "retard", mode: "token" },
  { term: "pedophile", mode: "substring" },
  { term: "rape", mode: "token" }
];
