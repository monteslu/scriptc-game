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
# the build matrix; otherwise the HOST platform (scripts/host-target.sh).
# Detecting here rather than defaulting to one target means a plain
# `build.sh <game>` links the right architecture's archives on every dev
# machine, not just Linux x86_64.
. "$(dirname "$0")/host-target.sh"
TARGET="${2:-${SG_TARGET:-$(host_target)}}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# macOS GL builds need ANGLE (gen-ffi refuses without it). The fetched
# location is the only place it ever is locally, so export it rather than
# make every shell do so; an explicit ANGLE_LIB still wins.
case "$TARGET" in
  macos-*)
    if [ -z "${ANGLE_LIB:-}" ] && [ -d "$ROOT/vendor/$TARGET/angle/lib" ]; then
      export ANGLE_LIB="$ROOT/vendor/$TARGET/angle/lib"
    fi
    ;;
esac
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

# The WebGL tier, when the manifest asked for it. Driven off the generated
# manifest rather than a guess, so it tracks gen-ffi.js's `usesGl` exactly.
#
# This is built HERE rather than left to the developer because it was
# originally built by hand and never scripted: it existed on one machine,
# and every CI run failed with "libraries[0] cannot be read ... libsggl.a".
# A step nobody can forget is the only kind that stays fixed.
if grep -q 'libsggl\.a' "$ROOT/ffi/core.ffi.json" 2>/dev/null; then
  GL_LOG="$(mktemp)"
  if ! "$ROOT/scripts/build-gl.sh" "$TARGET" > "$GL_LOG" 2>&1; then
    echo "build-gl.sh failed (target=$TARGET):" >&2
    tail -30 "$GL_LOG" >&2
    rm -f "$GL_LOG"
    exit 1
  fi
  rm -f "$GL_LOG"
fi

# Bake any shared models the game asks for. Sources are .glb in
# examples/shared/models/; the .sgm output is gitignored, so a clean clone
# must generate it or the game loads nothing and silently shows
# placeholders.
if [ -d "$INPUT/public" ] && ls "$INPUT"/*.ts >/dev/null 2>&1 &&
   grep -qs '\.sgm' "$INPUT"/*.ts; then
  # A game states its model set with a `models` file naming the shared
  # directory to bake from; without one it gets the default kit.
  SRC="examples/shared/models"
  [ -f "$INPUT/models" ] && SRC="examples/shared/$(cat "$INPUT/models")"
  "$ROOT/scripts/bake-models.sh" "$INPUT/public" "$SRC" >/dev/null || {
    echo "bake-models.sh failed" >&2; exit 1; }
  # Any atlas the kit ships beside its models.
  cp -f "$ROOT/$SRC"/*.png "$INPUT/public/" 2>/dev/null || true
fi

OUT="$ROOT/build/$BASE"
mkdir -p "$(dirname "$OUT")"
node "$SCRIPTC" build "$ENTRY" --ffi "$ROOT/ffi/core.ffi.json" -o "$OUT"

# macOS + GL: the kivy ANGLE prebuilts carry RELATIVE install names
# ("./libEGL.dylib"), which the linker copies into the binary verbatim, and
# dyld then resolves against the CWD -- so the binary only launches from one
# directory, if that. fetch-angle.sh rewrites the dylibs in place where the
# toolchain allows it (they ship with no header padding, so a CLT-only
# install_name_tool cannot); rewriting the BINARY always works, because
# clang linked it locally with room to spare. A no-op when the recorded
# names are already absolute.
case "$TARGET" in
  macos-*)
    if grep -q 'libEGL\.dylib' "$ROOT/ffi/core.ffi.json" 2>/dev/null &&
       command -v install_name_tool >/dev/null 2>&1; then
      A="${ANGLE_LIB:-$ROOT/vendor/$TARGET/angle/lib}"
      install_name_tool -change ./libGLESv2.dylib "$A/libGLESv2.dylib" \
                        -change ./libEGL.dylib "$A/libEGL.dylib" "$OUT"
      # install_name_tool invalidates the ad-hoc signature; dyld refuses an
      # unsigned arm64 binary, so re-sign.
      codesign --force --sign - "$OUT" 2>/dev/null || true
    fi
    ;;
esac

echo "built $OUT"
