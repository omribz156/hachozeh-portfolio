#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
screenshot_dir="${script_dir}/../reports/astro-migration/mobile"

mkdir -p "$screenshot_dir"

if [ "$#" -gt 0 ]; then
  for target in "$@"; do
    rm -f "${screenshot_dir}/${target}-mobile.png"
  done
else
  rm -f "${screenshot_dir}"/*-mobile.png
fi

"${script_dir}/run-browser-qa.sh" "$@"

echo
echo "== screenshot artifacts =="

if [ "$#" -gt 0 ]; then
  for target in "$@"; do
    screenshot_path="${screenshot_dir}/${target}-mobile.png"

    if [ ! -f "${screenshot_path}" ]; then
      echo "missing screenshot for ${target}" >&2
      exit 1
    fi

    printf '%s\n' "$screenshot_path"
  done
else
  find "$screenshot_dir" -type f -name '*-mobile.png' | sort
fi
