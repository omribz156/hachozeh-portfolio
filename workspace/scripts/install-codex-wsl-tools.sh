#!/usr/bin/env bash
set -euo pipefail

tools=(
  node
  npm
  npx
  corepack
  pnpm
  tsc
  eslint
  prettier
  nodemon
)

codex_home="${1:-${CODEX_HOME:-}}"

if [ -z "$codex_home" ]; then
  echo "CODEX_HOME is not set. Pass it explicitly or run this from a Codex WSL session." >&2
  exit 1
fi

wrapper_dir="${codex_home}/bin/wsl"
mkdir -p "$wrapper_dir"

cat > "${wrapper_dir}/nvm-tool" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

tool="${1:?missing tool name}"
shift

export NVM_DIR="${HOME}/.nvm"

if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  echo "nvm not found at $NVM_DIR" >&2
  exit 1
fi

. "$NVM_DIR/nvm.sh"
nvm use default >/dev/null

if [ -z "${NVM_BIN:-}" ] || [ ! -x "$NVM_BIN/$tool" ]; then
  echo "tool not found in active nvm bin: $tool" >&2
  exit 1
fi

exec "$NVM_BIN/$tool" "$@"
EOF

chmod +x "${wrapper_dir}/nvm-tool"

for tool in "${tools[@]}"; do
  cat > "${wrapper_dir}/${tool}" <<EOF
#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR=\$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
exec "\$SCRIPT_DIR/nvm-tool" ${tool} "\$@"
EOF

  chmod +x "${wrapper_dir}/${tool}"
done

printf 'Installed Codex WSL wrappers in %s\n' "$wrapper_dir"
printf '%s\n' 'Managed wrappers:'
printf '  %s\n' nvm-tool "${tools[@]}"
