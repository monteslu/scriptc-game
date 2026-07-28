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
# An explicit second argument wins; otherwise SG_TARGET, which CI sets from
# the build matrix. Defaulting here rather than in each caller means a new
# script cannot silently link the wrong architecture's archives.
TARGET="${2:-${SG_TARGET:-linux-x86_64}}"
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
# Quiet on success, but a FAILURE must say why: this step exited non-zero
# with nothing on stdout or stderr on a CI runner once, which is
# undiagnosable from a log.
SHIM_LOG="$(mktemp)"
if ! "$ROOT/scripts/build-shim.sh" "$TARGET" > "$SHIM_LOG" 2>&1; then
  echo "build-shim.sh failed (target=$TARGET):" >&2
  tail -30 "$SHIM_LOG" >&2
  rm -f "$SHIM_LOG"
  exit 1
fi
rm -f "$SHIM_LOG"

OUT="$ROOT/build/$BASE"
mkdir -p "$(dirname "$OUT")"
node "$SCRIPTC" build "$ENTRY" --ffi "$ROOT/ffi/core.ffi.json" -o "$OUT"
echo "built $OUT"
