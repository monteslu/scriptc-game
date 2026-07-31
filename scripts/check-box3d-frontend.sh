#!/usr/bin/env bash
# The box3d seam's drift guard: web/box3d/frontend.ts must be a
# byte-identical copy of box3d-wasm's src/frontend.ts (the shared binding
# personality). Byte identity is checked against the sha256 pinned in
# versions.json, so a local edit to the vendored copy fails HERE rather
# than shipping a native binding that silently disagrees with the wasm one.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

WANT=$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).box3d.frontend_sha256)' "$ROOT/versions.json")
GOT=$(sha256sum "$ROOT/web/box3d/frontend.ts" | awk '{print $1}')

if [ "$WANT" != "$GOT" ]; then
  echo "web/box3d/frontend.ts drifted from the box3d-wasm frontend pin:" >&2
  echo "  pinned  $WANT" >&2
  echo "  actual  $GOT" >&2
  echo "Re-copy from box3d-wasm src/frontend.ts (or update versions.json" >&2
  echo "if the frontend legitimately moved) -- never edit the copy." >&2
  exit 1
fi
echo "box3d frontend matches its pin"
