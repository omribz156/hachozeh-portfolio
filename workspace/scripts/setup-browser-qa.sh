#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/../.." && pwd)
qa_dir=$(CDPATH= cd -- "${script_dir}/../browser-qa" && pwd)
tmp_dir="/tmp/navi-browser-qa"
install_mode="${1:-}"
vendor_deb_dir="${qa_dir}/.linux-debs"
vendor_lib_dir="${qa_dir}/.linux-libs"
vendor_packages=(
  libnspr4
  libnss3
  libasound2t64
)

. "${qa_dir}/load-native-node.sh"

mkdir -p "$tmp_dir"
export TMPDIR="$tmp_dir"
export TMP="$tmp_dir"
export TEMP="$tmp_dir"

cd "$repo_root"
npm install

mkdir -p "$vendor_deb_dir"
rm -rf "$vendor_lib_dir"
mkdir -p "$vendor_lib_dir"

(cd "$vendor_deb_dir" && apt download "${vendor_packages[@]}")

for deb in "$vendor_deb_dir"/*.deb; do
  dpkg-deb -x "$deb" "$vendor_lib_dir"
done

if [ "$install_mode" = "--with-deps" ]; then
  (cd "$qa_dir" && npx playwright install --with-deps chromium)
else
  (cd "$qa_dir" && npx playwright install chromium)
fi
