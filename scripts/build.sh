#!/usr/bin/env bash
# Build a game into a native binary.
#
#   build.sh examples/dodge          a GAME DIRECTORY (the normal case)
#   build.sh test/conformance.ts     a bare .ts entry (tests and probes)
#
# A game directory is the web root: its entry file is found by convention
# (main.ts, src/main.ts, ...) and codegen/gen-entry.js writes the boot entry
# that opens a window, evaluates the game, and starts the frame loop. Tests
# are not games -- they drive host/ directly -- so a .ts path is built as-is.
set -euo pipefail
INPUT="${1:?usage: build.sh <gameDir|entry.ts> [target]}"
TARGET="${2:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPTC="${SCRIPTC_BIN:-$ROOT/../scriptc/packages/cli/dist/main.js}"

if [ -d "$INPUT" ]; then
  # Strip a trailing slash so basename gives the game name, not "".
  GAMEDIR="${INPUT%/}"
  ENTRY="$GAMEDIR/.sg-build/entry.ts"
  node "$ROOT/codegen/gen-entry.js" "$GAMEDIR" "$ENTRY"
  BASE="$(basename "$GAMEDIR")"
else
  ENTRY="$INPUT"
  BASE="$(basename "${ENTRY%.ts}")"
  # A bare main.ts is named after its directory, so two examples do not both
  # build to build/main.
  if [ "$BASE" = "main" ]; then
    BASE="$(basename "$(dirname "$ENTRY")")"
  fi
fi

node "$ROOT/codegen/gen-ffi.js" "$TARGET" "$ENTRY"
"$ROOT/scripts/build-shim.sh" "$TARGET" >/dev/null

OUT="$ROOT/build/$BASE"
mkdir -p "$(dirname "$OUT")"
node "$SCRIPTC" build "$ENTRY" --ffi "$ROOT/ffi/core.ffi.json" -o "$OUT"
echo "built $OUT"
