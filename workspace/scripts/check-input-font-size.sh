#!/usr/bin/env bash
# Guard against the iOS focus-zoom regression: font-size on input/textarea/select
# rules must be a literal px value >= 16px, not a rem/em unit. Below 16px, iOS
# Safari auto-zooms the viewport on focus and the zoom+pan offset persists after
# the field's overlay/panel closes (see the "16px floor" comments in
# patterns/auth-overlays.css, patterns/dispute-modal.css, patterns/idea-overlay.css,
# pages/settings.css, pages/community-island.css, pages/profile.css,
# pages/profile-portfolio-tables.css, pages/portfolio.css).
#
# What it does:
#   For every CSS rule block in systems/web/src/styles whose selector mentions
#   input, textarea, or select, look for a font-size declared in rem/em units
#   and flag it.
#
# Heuristic, not a CSS parser:
#   - Rule blocks are split on "}" then matched back to their selector, so a
#     selector and its declarations must live in the same file (true for this
#     codebase's authoring style). Nested at-rules (@media { ... }) are walked
#     line-by-line so selectors inside them are still caught.
#   - Only flags rem/em. Keyword/percentage font-size and font shorthand with a
#     rem/em size would slip through — none of that appears on real inputs
#     today, so it's not worth a heavier parser.
#   - A selector merely containing the substring "select" (e.g. a class named
#     `.foo-selected`) could false-positive; skim the report before trusting it
#     blindly, but in practice these class names don't collide in this codebase.
#
# Allowlist:
#   patterns/trade-ticket.css `input.hz-amount-input--stage` is rem-sized
#   (1.46rem) on purpose — it's the large trade-amount display, not a small
#   form field, and even at the fluid root's floor (13px) it computes to
#   ~19px, always above the 16px zoom threshold. Exempted below rather than
#   forced to a literal px, which would freeze it out of the fluid type scale.
#   Add future deliberate exceptions to ALLOWLIST the same way, with the same
#   kind of comment justifying why the rem size can never dip under 16px.
#
# Same-selector override exemption (pattern, not a per-file allowlist entry):
#   iOS decides whether to zoom based on the FOCUSED element's computed
#   font-size at the moment focus lands. A base rule may keep a small rem/em
#   size as long as ANOTHER rule for the same selector in the same file sets a
#   literal font-size >= 16px in the context where zoom can actually happen —
#   either a `:focus` variant, or a coarse-pointer @media override (desktop
#   never zooms, so a desktop-only rem base is safe when touch gets 16px).
#   See pages/trending-stage.css `.hz-trending__sort select` (rem base +
#   literal 16px inside `(hover: none) and (pointer: coarse)`) for the
#   reference shape. Checked structurally by selector text, so any future
#   control using either shape is auto-exempted.
#
# Exit codes:
#   0 — no violations found
#   1 — one or more input/textarea/select rules use rem/em font-size

set -uo pipefail

STYLES_DIR="${1:-systems/web/src/styles}"
REPO_ROOT="$(cd "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET_DIR="${REPO_ROOT}/${STYLES_DIR}"

if [ ! -d "$TARGET_DIR" ]; then
  echo "[check-input-font-size] styles dir not found: $TARGET_DIR" >&2
  exit 1
fi

ALLOWLIST="patterns/trade-ticket.css:input.hz-amount-input--stage"

violations=""

while IFS= read -r -d '' css_file; do
  rel_file="${css_file#$REPO_ROOT/}"

  # awk walks the file rule-block by rule-block: accumulate lines between the
  # last "{" (selector) and the matching "}" (declarations), then test both.
  # Selector/body are flattened to single lines (newlines -> spaces) so each
  # violation prints as one readable "file:line: selector { declarations }" row.
  result=$(awk '
    BEGIN { selector = "" ; buf = "" ; depth = 0 }
    {
      line = $0
      gsub(/\/\*.*\*\//, "", line)   # strip single-line comments
      n = length(line)
      for (i = 1; i <= n; i++) {
        c = substr(line, i, 1)
        if (c == "{") {
          if (depth == 0) {
            gsub(/\n/, " ", buf); gsub(/[ \t]+/, " ", buf); gsub(/^ +| +$/, "", buf)
            selector = buf; buf = ""; start_line = FNR
          }
          depth++
        } else if (c == "}") {
          depth--
          if (depth == 0) {
            gsub(/\n/, " ", buf); gsub(/[ \t]+/, " ", buf); gsub(/^ +| +$/, "", buf)
            if (selector ~ /(^|[^A-Za-z0-9_-])(input|textarea|select)([^A-Za-z0-9_-]|$)/) {
              if (buf ~ /font-size[ \t]*:[ \t]*[0-9.]+(rem|em)/) {
                print start_line": "selector" { "buf" }"
              }
            }
            buf = ""
          }
        } else {
          buf = buf c
        }
      }
      buf = buf "\n"
    }
  ' "$css_file")

  if [ -n "$result" ]; then
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      selector_part="${line#*: }"
      selector_only="${selector_part%% \{*}"
      is_allowed=0
      for entry in $ALLOWLIST; do
        allow_file="${entry%%:*}"
        allow_selector="${entry#*:}"
        if [ "$rel_file" = "systems/web/src/styles/${allow_file}" ] && [[ "$selector_part" == *"$allow_selector"* ]]; then
          is_allowed=1
          break
        fi
      done
      # :focus-scoped exemption: if this exact selector also has a `:focus`
      # variant elsewhere in the same file with a literal font-size >= 16px,
      # the zoom is suppressed at focus-time even though the resting rule
      # is rem/em. Build "<selector>:focus" (handling a trailing comma-list
      # selector by appending :focus to the whole thing, which matches this
      # codebase's single-selector authoring style for inputs) and grep the
      # file for that rule with a 16+px font-size.
      if [ "$is_allowed" = "0" ]; then
        # Collect EVERY rule block in the file whose opening line carries the
        # same selector (bare or :focus variant) — a media-nested override is
        # just another occurrence — and exempt if any of them declares a
        # literal font-size >= 16px.
        if awk -v sel_base="${selector_only} {" -v sel_focus="${selector_only}:focus {" '
          index($0, sel_base) || index($0, sel_focus) { found=1 }
          found { print; if ($0 ~ /^[ \t]*}/) found=0 }
        ' "$css_file" | grep -qE 'font-size[ \t]*:[ \t]*(1[6-9]|[2-9][0-9])px'; then
          is_allowed=1
        fi
      fi
      [ "$is_allowed" = "1" ] && continue
      violations="${violations}${rel_file}:${line}"$'\n'
    done <<< "$result"
  fi
done < <(find "$TARGET_DIR" -name '*.css' -print0)

if [ -n "$violations" ]; then
  echo "[check-input-font-size] rem/em font-size found on input/textarea/select rules:" >&2
  echo "$violations" >&2
  echo "[check-input-font-size] fix: literal font-size: 16px (see auth-overlays.css for the comment convention)" >&2
  exit 1
fi

echo "[check-input-font-size] OK: no rem/em font-size on input/textarea/select rules in $STYLES_DIR"
exit 0
