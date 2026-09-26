// display-name-guard.ts — normalization + matching for the display-name
// blocklist in name-blocklist.ts. See that file's header for the curation
// rules and the חזה/החוזה false-positive rationale this design is built around.
//
// Matching pipeline:
//   1. Normalize the whole input (lowercase latin, strip niqqud, collapse
//      punctuation/underscores/dots/whitespace into single spaces, apply leet
//      substitution) into two views:
//        - `collapsed`: normalized with ALL separators removed entirely
//          (catches spacing tricks like "ל.א.ו.נ.ן" or "f u c k").
//        - `tokens`: normalized and split on separators into words (catches
//          exact-word matches without nuking substrings of longer words).
//   2. A `token`-tagged entry matches only if it equals one of `tokens`.
//   3. A `substring`-tagged entry matches if it appears anywhere in
//      `collapsed`.

import { DISPLAY_NAME_BLOCKLIST } from "./name-blocklist";

const NIQQUD_PATTERN = /[֑-ׇ]/g;
const SEPARATOR_PATTERN = /[\s._\-'"`~,!?/\\|@#*+=:;()[\]{}<>]+/g;

// Common leet substitutions applied only to latin runs. Kept intentionally
// small: aggressive leet mapping on Hebrew or on latin words in general would
// create new false positives (e.g. mapping every "1" to "i").
const LEET_SUBSTITUTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/0/g, "o"],
  [/1/g, "i"],
  [/3/g, "e"],
  [/4/g, "a"],
  [/5/g, "s"],
  [/7/g, "t"],
  [/@/g, "a"],
  [/\$/g, "s"]
];

function applyLeetSubstitutions(value: string): string {
  let result = value;
  for (const [pattern, replacement] of LEET_SUBSTITUTIONS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function baseNormalize(value: string): string {
  return applyLeetSubstitutions(value.toLocaleLowerCase("en-US").replace(NIQQUD_PATTERN, ""));
}

export function collapseForBlocklistMatch(value: string): string {
  return baseNormalize(value).replace(SEPARATOR_PATTERN, "");
}

export function tokenizeForBlocklistMatch(value: string): string[] {
  return baseNormalize(value)
    .split(SEPARATOR_PATTERN)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export function containsBlockedTerm(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  const collapsed = collapseForBlocklistMatch(trimmed);
  const tokens = tokenizeForBlocklistMatch(trimmed);
  const tokenSet = new Set(tokens);

  for (const entry of DISPLAY_NAME_BLOCKLIST) {
    const normalizedTerm = baseNormalize(entry.term);

    if (entry.mode === "token") {
      const termTokens = normalizedTerm.split(SEPARATOR_PATTERN).filter(Boolean);
      if (termTokens.length <= 1) {
        // Exact whole-word match, OR every character of the term was typed
        // as its own separated token (the "ל.א.ו.נ.ן" spacing trick) — in
        // that case the input collapses to exactly the term with no other
        // characters, so it's still an exact-word hit, not a substring hit
        // inside a longer innocent word.
        if (tokenSet.has(normalizedTerm)) return true;
        const termLetters = normalizedTerm.replace(SEPARATOR_PATTERN, "");
        if (
          termLetters.length > 1 &&
          tokens.length === termLetters.length &&
          tokens.every((token) => token.length === 1) &&
          collapsed === termLetters
        ) {
          return true;
        }
      } else {
        // Multi-word token entries (e.g. "בן זונה") match as a contiguous
        // token sequence rather than a single collapsed substring, so they
        // still don't spill into unrelated collapsed strings.
        if (collapseForBlocklistMatch(entry.term) === collapsed) return true;
        for (let i = 0; i + termTokens.length <= tokens.length; i += 1) {
          let allMatch = true;
          for (let j = 0; j < termTokens.length; j += 1) {
            if (tokens[i + j] !== termTokens[j]) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) return true;
        }
      }
      continue;
    }

    // substring mode
    const collapsedTerm = collapseForBlocklistMatch(entry.term);
    if (collapsedTerm && collapsed.includes(collapsedTerm)) return true;
  }

  return false;
}
