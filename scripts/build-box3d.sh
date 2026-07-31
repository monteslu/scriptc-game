#!/usr/bin/env bash
# Build Box3D (Erin Catto's 3D physics engine) as a static library for the
# native side of the box3d seam, plus the flat FFI shim that fronts it.
#
# The SHA below MUST match box3d-wasm's scripts/versions.json: the browser
# side of a game runs box3d-wasm, and "isomorphic" only means something if
# both worlds run the same engine bytes. Bump them together (and the
# box3d_wasm pin in versions.json, which CI uses for the browser proof).
#
# Compiled DIRECTLY with clang, the build-webaudio.sh pattern: the source
# is fetched (never vendored) and every .c under src/ is compiled as-is.
# No cmake -- a generator that picks MSVC on Windows and Makefiles
# elsewhere is exactly the per-platform divergence this repo avoids.
# SIMD is on by default upstream (SSE2-class); threads come from Box3D's
# in-tree scheduler, which platform.h backs with pthreads or win32.
#
#   ./scripts/build-box3d.sh [target]  -> vendor/<target>/box3d/{libbox3d.a,libsgbox3d.a}
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/host-target.sh"
TARGET="${1:-${SG_TARGET:-$(host_target)}}"

BOX3D_REPO="https://github.com/erincatto/box3d.git"
BOX3D_SHA="29bf523ce7bc4590aba9f17c9db791cdc5c4397e"   # = box3d-wasm pin

SRC="$ROOT/.deps/box3d"
DEST="$ROOT/vendor/$TARGET/box3d"
OBJ="$ROOT/vendor/$TARGET/obj/box3d"

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$ROOT/.deps"
  git clone --no-checkout "$BOX3D_REPO" "$SRC"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null)" != "$BOX3D_SHA" ]; then
  git -C "$SRC" fetch --quiet origin "$BOX3D_SHA" 2>/dev/null || git -C "$SRC" fetch --quiet
  git -C "$SRC" checkout --quiet "$BOX3D_SHA"
fi

CC_BIN="${SG_CC:-clang}"
CFLAGS="-O2 -std=c17 -fvisibility=hidden -DNDEBUG"
INC="-I$SRC/include -I$SRC/src"

mkdir -p "$DEST/include" "$OBJ"

OBJS=""
for c in "$SRC"/src/*.c; do
  base="$(basename "$c" .c)"
  o="$OBJ/$base.o"
  if [ ! -f "$o" ] || [ "$c" -nt "$o" ]; then
    "$CC_BIN" $CFLAGS $INC -c "$c" -o "$o"
  fi
  OBJS="$OBJS $o"
done
rm -f "$DEST/libbox3d.a"
ar rcs "$DEST/libbox3d.a" $OBJS

cp -r "$SRC/include/box3d" "$DEST/include/"
echo "$BOX3D_SHA" > "$DEST/BOX3D_SHA"

# The flat shim (the native half of the backend contract; see
# shim/sg_box3d.c). Its own archive so gen-ffi can gate the whole seam on
# one library name, the libsggl.a pattern.
"$CC_BIN" $CFLAGS -c "$ROOT/shim/sg_box3d.c" \
  -o "$OBJ/sg_box3d.o" -I "$DEST/include"
ar rcs "$DEST/libsgbox3d.a" "$OBJ/sg_box3d.o"

echo "built $DEST/libbox3d.a + libsgbox3d.a @ $BOX3D_SHA"
