#!/usr/bin/env bash
# Install (or uninstall/query) the com.hachozeh.backup-postgres launchd agent.
#
# What it does:
#   - Writes a LaunchAgent plist to ~/Library/LaunchAgents/.
#   - Schedules workspace/scripts/backup-postgres.sh daily at 03:30 local time.
#   - Logs stdout + stderr to workspace/runtime/backup-postgres.log.
#
# Usage:
#   workspace/scripts/install-backup-launchd.sh            # install (default)
#   workspace/scripts/install-backup-launchd.sh uninstall  # remove agent
#   workspace/scripts/install-backup-launchd.sh status     # print agent state
#   workspace/scripts/install-backup-launchd.sh run-now    # kick off immediately
#
# Does NOT run the installer on its own — source it or call it explicitly.

set -euo pipefail

ACTION="${1:-install}"
LABEL="com.hachozeh.backup-postgres"
USER_ID="$(id -u)"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/../.." && pwd)"
PLIST_DIR="${HOME}/Library/LaunchAgents"
PLIST_PATH="${PLIST_DIR}/${LABEL}.plist"
BACKUP_SCRIPT="${SCRIPT_DIR}/backup-postgres.sh"
RUNTIME_DIR="${REPO_ROOT}/workspace/runtime"
LOG_FILE="${RUNTIME_DIR}/backup-postgres.log"

install_agent() {
  mkdir -p "$PLIST_DIR" "$RUNTIME_DIR"

  cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>${LABEL}</string>
    <key>ProgramArguments</key>
    <array>
      <string>/bin/bash</string>
      <string>${BACKUP_SCRIPT}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${REPO_ROOT}</string>
    <key>EnvironmentVariables</key>
    <dict>
      <key>PATH</key>
      <string>${HOME}/.orbstack/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
    <key>StartCalendarInterval</key>
    <dict>
      <key>Hour</key>
      <integer>3</integer>
      <key>Minute</key>
      <integer>30</integer>
    </dict>
    <key>StandardOutPath</key>
    <string>${LOG_FILE}</string>
    <key>StandardErrorPath</key>
    <string>${LOG_FILE}</string>
  </dict>
</plist>
EOF

  launchctl bootout "gui/${USER_ID}/${LABEL}" "$PLIST_PATH" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/${USER_ID}" "$PLIST_PATH"
  launchctl enable "gui/${USER_ID}/${LABEL}" >/dev/null 2>&1 || true

  printf 'Installed %s — runs daily at 03:30 via %s\n' "$LABEL" "$PLIST_PATH"
  printf 'Log: %s\n' "$LOG_FILE"
}

uninstall_agent() {
  launchctl bootout "gui/${USER_ID}/${LABEL}" "$PLIST_PATH" >/dev/null 2>&1 || true
  rm -f "$PLIST_PATH"
  printf 'Removed %s\n' "$LABEL"
}

status_agent() {
  launchctl print "gui/${USER_ID}/${LABEL}"
}

run_now() {
  launchctl kickstart -k "gui/${USER_ID}/${LABEL}"
}

case "$ACTION" in
  install)
    install_agent
    ;;
  uninstall)
    uninstall_agent
    ;;
  status)
    status_agent
    ;;
  run-now)
    run_now
    ;;
  *)
    echo "Usage: $0 [install|uninstall|status|run-now]" >&2
    exit 1
    ;;
esac
