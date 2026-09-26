#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
qa_dir=$(CDPATH= cd -- "${script_dir}/../browser-qa" && pwd)
tmp_dir="/tmp/navi-browser-qa"
vendor_lib_dir="${qa_dir}/.linux-libs/usr/lib/x86_64-linux-gnu"

. "${qa_dir}/load-native-node.sh"

if [ ! -d "${qa_dir}/node_modules" ]; then
  echo "browser QA deps are missing. Run ./workspace/scripts/setup-browser-qa.sh first." >&2
  exit 1
fi

mkdir -p "$tmp_dir"
export TMPDIR="$tmp_dir"
export TMP="$tmp_dir"
export TEMP="$tmp_dir"

if [ -d "$vendor_lib_dir" ]; then
  export LD_LIBRARY_PATH="${vendor_lib_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
fi

unset NO_COLOR

if [ "$#" -gt 0 ]; then
  export A11Y_TARGETS="$(printf '%s\n' "$@" | paste -sd, -)"
fi

cd "$qa_dir"
npx playwright test tests/astro-a11y.spec.mjs
