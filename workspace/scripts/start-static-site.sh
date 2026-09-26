#!/usr/bin/env bash
set -euo pipefail

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
repo_root=$(CDPATH= cd -- "${script_dir}/../.." && pwd)
port="${1:-4173}"
host="${HOST:-127.0.0.1}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to serve the static repo site" >&2
  exit 1
fi

echo "Serving ${repo_root} at http://${host}:${port}"
export NAVI_STATIC_ROOT="$repo_root"
export NAVI_STATIC_HOST="$host"
export NAVI_STATIC_PORT="$port"

exec python3 - <<'PY'
import functools
import http.server
import os
import socketserver

root = os.environ["NAVI_STATIC_ROOT"]
host = os.environ["NAVI_STATIC_HOST"]
port = int(os.environ["NAVI_STATIC_PORT"])


class NoCacheStaticHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=root, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()


class ReusableTCPServer(socketserver.TCPServer):
    allow_reuse_address = True


with ReusableTCPServer((host, port), NoCacheStaticHandler) as httpd:
    httpd.serve_forever()
PY
