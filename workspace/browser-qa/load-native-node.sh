#!/usr/bin/env bash
set -euo pipefail

export NVM_DIR="${HOME}/.nvm"
codex_home="${CODEX_HOME:-${HOME}/.codex}"
codex_wsl_bin="${codex_home}/bin/wsl"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found at $NVM_DIR" >&2
  exit 1
fi

# Keep Codex wrappers out of the lookup path while nvm activates the native toolchain.
path_without_codex_wsl=$(
  printf '%s' "${PATH}" | awk -v RS=: -v ORS=: -v skip="$codex_wsl_bin" '
    $0 != skip && !seen[$0]++ { print }
  ' | sed 's/:$//'
)

export PATH="${path_without_codex_wsl}"
. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

if [ -z "${NVM_BIN:-}" ] || [ ! -x "$NVM_BIN/node" ] || [ ! -x "$NVM_BIN/npm" ]; then
  echo "native nvm Node/npm not available in the active default version" >&2
  exit 1
fi

export PATH="$NVM_BIN:/usr/bin:/bin:${path_without_codex_wsl}"
hash -r
