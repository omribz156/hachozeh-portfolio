#!/usr/bin/env bash
# Send a platform alert via Telegram.
#
# This script is the alert seam for the Hachozeh platform. It posts a short
# message to a dedicated Telegram bot. If either key is unset, it is a
# deliberate no-op — the seam is wired at code time; the bot is created and
# keys are pasted in at deploy time.
#
# Usage:
#   platform-alert.sh send "<message>"
#   platform-alert.sh --require-delivery send "<message>"
#   platform-alert.sh --dry-run send "<message>"
#
# Commands:
#   send "<message>"   Post the message to Telegram (or no-op if keys unset).
#
# Flags:
#   --dry-run          Print the would-be curl request shape to stdout WITHOUT
#                      including the token value and WITHOUT calling the network.
#                      Safe to run at any time; always exits 0.
#   --require-delivery Exit non-zero when credentials are missing or Telegram
#                      does not acknowledge the message. Monitors use this to
#                      avoid recording or deduping alerts that were not sent.
#
# Required env keys (both must be set to activate; either unset → no-op):
#   PLATFORM_ALERT_TELEGRAM_BOT_TOKEN   Token from @BotFather for the dedicated
#                                       platform-ops bot (NOT the oracle/reminders
#                                       bot — these are separate bots by design).
#   PLATFORM_ALERT_TELEGRAM_CHAT_ID     Telegram chat ID to deliver alerts to.
#                                       Get it via @userinfobot or the API.
#
# Wire-up steps (owner, at deploy time):
#   1. Create a new bot via @BotFather → /newbot → save the token.
#   2. Start a chat with the bot (or add it to a group/channel).
#   3. Get the chat ID (send a message then visit:
#      https://api.telegram.org/bot<TOKEN>/getUpdates).
#   4. Set both keys in your private-ops env file (NOT in .env or git):
#        PLATFORM_ALERT_TELEGRAM_BOT_TOKEN=<token>
#        PLATFORM_ALERT_TELEGRAM_CHAT_ID=<chat_id>
#   5. Source that file in the launchd plist EnvironmentVariables dict or in
#      your shell profile — see workspace/deploy/alerting.md.
#
# NEVER echo the token value. Log key NAMES only.

set -euo pipefail

# --- parse flags ---
DRY_RUN=false
REQUIRE_DELIVERY=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--dry-run" ]]; then
    DRY_RUN=true
  elif [[ "$arg" == "--require-delivery" ]]; then
    REQUIRE_DELIVERY=true
  else
    ARGS+=("$arg")
  fi
done
set -- "${ARGS[@]+"${ARGS[@]}"}"

# --- usage ---
COMMAND="${1:-}"
if [[ "$COMMAND" != "send" ]]; then
  echo "Usage: $(basename "$0") [--dry-run] send \"<message>\"" >&2
  exit 1
fi
MESSAGE="${2:-}"
if [[ -z "$MESSAGE" ]]; then
  echo "Usage: $(basename "$0") [--dry-run] send \"<message>\"" >&2
  exit 1
fi

TOKEN="${PLATFORM_ALERT_TELEGRAM_BOT_TOKEN:-}"
CHAT_ID="${PLATFORM_ALERT_TELEGRAM_CHAT_ID:-}"

# Self-load the private-ops env when keys aren't in the environment — callers
# like the watchdog node process don't source it, and requiring every caller
# to wire env plumbing is how this seam stayed no-op for a month. Values are
# read into locals only; nothing is echoed.
PRIVATE_OPS_ENV_FILE="${PRIVATE_OPS_ENV_FILE:-}"
if [[ -z "$TOKEN" || -z "$CHAT_ID" ]] && [[ -f "$PRIVATE_OPS_ENV_FILE" ]]; then
  TOKEN="${TOKEN:-$(grep '^PLATFORM_ALERT_TELEGRAM_BOT_TOKEN=' "$PRIVATE_OPS_ENV_FILE" | tail -1 | cut -d= -f2-)}"
  CHAT_ID="${CHAT_ID:-$(grep '^PLATFORM_ALERT_TELEGRAM_CHAT_ID=' "$PRIVATE_OPS_ENV_FILE" | tail -1 | cut -d= -f2-)}"
fi

# --- dry-run path: print request shape, no network, no token in output ---
if [[ "$DRY_RUN" == "true" ]]; then
  echo "[platform-alert] dry-run: would POST to Telegram sendMessage"
  echo "  URL: https://api.telegram.org/bot<PLATFORM_ALERT_TELEGRAM_BOT_TOKEN>/sendMessage"
  echo "  chat_id: ${CHAT_ID:-<PLATFORM_ALERT_TELEGRAM_CHAT_ID not set>}"
  echo "  text: ${MESSAGE}"
  echo "  parse_mode: (none)"
  echo "[platform-alert] dry-run: no network call made"
  exit 0
fi

# --- no-op path: either key unset ---
if [[ -z "$TOKEN" || -z "$CHAT_ID" ]]; then
  echo "[platform-alert] alert seam: not configured (message: ${MESSAGE})" >&2
  if [[ "$REQUIRE_DELIVERY" == "true" ]]; then
    exit 2
  fi
  exit 0
fi

# --- live send ---
TELEGRAM_URL="https://api.telegram.org/bot${TOKEN}/sendMessage"

HTTP_STATUS="$(curl -s -o /dev/null -w "%{http_code}" \
  --max-time 10 \
  -X POST "$TELEGRAM_URL" \
  --data-urlencode "chat_id=${CHAT_ID}" \
  --data-urlencode "text=${MESSAGE}")"

if [[ "$HTTP_STATUS" == "200" ]]; then
  echo "[platform-alert] sent (HTTP ${HTTP_STATUS})"
else
  echo "[platform-alert] WARNING: Telegram API returned HTTP ${HTTP_STATUS}" >&2
  if [[ "$REQUIRE_DELIVERY" == "true" ]]; then
    exit 2
  fi
  exit 0
fi
