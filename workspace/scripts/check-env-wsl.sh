#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
native_node_loader="${script_dir}/browser-qa/load-native-node.sh"

# For version checks, prefer the native WSL Node toolchain over Codex wrapper hops.
if [ -f "$native_node_loader" ]; then
  . "$native_node_loader" >/dev/null 2>&1 || true
  hash -r
fi

tools=(
  node
  npm
  npx
  pnpm
  git
  tsc
  eslint
  prettier
  nodemon
  corepack
  psql
  pg_isready
  tmux
)

wrapper_tools=(
  nvm-tool
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

wrapper_dir=""

if [ -n "${CODEX_HOME:-}" ]; then
  wrapper_dir="${CODEX_HOME}/bin/wsl"
fi

print_tool_path() {
  local tool="$1"

  if command -v "$tool" >/dev/null 2>&1; then
    printf '%-9s %s\n' "$tool" "$(command -v "$tool")"
    return
  fi

  printf '%-9s %s\n' "$tool" "missing"
}

print_tool_version() {
  local tool="$1"

  if ! command -v "$tool" >/dev/null 2>&1; then
    printf '%-9s %s\n' "$tool" "missing"
    return
  fi

  case "$tool" in
    git)
      printf '%-9s %s\n' "$tool" "$(git --version)"
      ;;
    tsc)
      printf '%-9s %s\n' "$tool" "$(tsc -v)"
      ;;
    eslint)
      printf '%-9s %s\n' "$tool" "$(eslint -v)"
      ;;
    prettier)
      printf '%-9s %s\n' "$tool" "$(prettier -v)"
      ;;
    nodemon)
      printf '%-9s %s\n' "$tool" "$(nodemon -v)"
      ;;
    corepack)
      printf '%-9s %s\n' "$tool" "$(corepack --version)"
      ;;
    psql)
      printf '%-9s %s\n' "$tool" "$(psql --version)"
      ;;
    pg_isready)
      printf '%-9s %s\n' "$tool" "$(pg_isready --version)"
      ;;
    tmux)
      printf '%-9s %s\n' "$tool" "$(tmux -V)"
      ;;
    *)
      printf '%-9s %s\n' "$tool" "$("$tool" -v)"
      ;;
  esac
}

print_node_lts() {
  if ! command -v node >/dev/null 2>&1; then
    printf 'node_lts=%s\n' "missing"
    return
  fi

  printf 'node_lts=%s\n' "$(node -p 'process.release.lts || "not-lts"')"
}

print_windows_gui_status() {
  local label="$1"
  shift
  local candidate

  for candidate in "$@"; do
    if [ -f "$candidate" ]; then
      printf '%-9s %s\n' "$label" "$candidate"
      return
    fi
  done

  printf '%-9s %s\n' "$label" "missing"
}

print_wrapper_status() {
  local tool="$1"
  local path="${wrapper_dir}/${tool}"

  if [ -x "$path" ]; then
    printf '%-9s %s\n' "$tool" "$path"
    return
  fi

  printf '%-9s %s\n' "$tool" "missing"
}

path_contains() {
  local needle="$1"

  case ":${PATH:-}:" in
    *":${needle}:"*)
      echo yes
      ;;
    *)
      echo no
      ;;
  esac
}

printf '%s\n' '--- Navi WSL Environment Check ---'
printf 'cwd=%s\n' "$PWD"
printf 'shell=%s\n' "${SHELL:-unset}"
printf 'home=%s\n' "${HOME:-unset}"
printf 'codex_home=%s\n' "${CODEX_HOME:-unset}"
printf 'repo=%s\n' "$(git rev-parse --show-toplevel 2>/dev/null || echo 'not-a-git-repo')"
printf 'wrapper_dir=%s\n' "${wrapper_dir:-unset}"

if [ -n "$wrapper_dir" ]; then
  printf 'wrapper_dir_in_path=%s\n' "$(path_contains "$wrapper_dir")"
fi

if [ -n "$wrapper_dir" ]; then
  printf '\n%s\n' 'Codex WSL Wrappers'
  for tool in "${wrapper_tools[@]}"; do
    print_wrapper_status "$tool"
  done
fi

printf '\n%s\n' 'Tool Paths'
for tool in "${tools[@]}"; do
  print_tool_path "$tool"
done

printf '\n%s\n' 'Versions'
for tool in "${tools[@]}"; do
  print_tool_version "$tool"
done

printf '\n%s\n' 'Node Release'
print_node_lts

printf '\n%s\n' 'Optional Windows DB GUI'
print_windows_gui_status "dbeaver" \
  "/mnt/c/Program Files/DBeaver/dbeaver.exe" \
  "/mnt/c/Program Files/DBeaver Community/dbeaver.exe"
print_windows_gui_status "pgadmin" \
  "/mnt/c/Program Files/pgAdmin 4/runtime/pgAdmin4.exe"

printf '\n%s\n' 'Git Line Ending Config'
printf 'core.autocrlf=%s\n' "$(git config --global --get core.autocrlf || echo unset)"
printf 'core.eol=%s\n' "$(git config --global --get core.eol || echo unset)"
printf 'core.safecrlf=%s\n' "$(git config --global --get core.safecrlf || echo unset)"
