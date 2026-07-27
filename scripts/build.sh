#!/usr/bin/env bash
# Build an example (or any entry .ts) into a native binary.
set -euo pipefail
ENTRY="${1:?usage: build.sh <entry.ts> [target]}"
TARGET="${2:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTC="${SCRIPTC_BIN:-$ROOT/../scriptc/packages/cli/dist/main.js}"

node "$ROOT/codegen/gen-ffi.js" "$TARGET"
"$ROOT/scripts/build-shim.sh" "$TARGET" >/dev/null

OUT="$ROOT/build/$(basename "${ENTRY%.ts}")"
mkdir -p "$(dirname "$OUT")"
node "$SCRIPTC" build "$ENTRY" --ffi "$ROOT/ffi/core.ffi.json" -o "$OUT"
echo "built $OUT"
