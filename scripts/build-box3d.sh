#!/usr/bin/env bash
# Build Box3D (Erin Catto's 3D physics engine) as a static library for the
# native side of the box3d seam.
#
# The SHA below MUST match box3d-wasm's scripts/versions.json: the browser
# side of a game runs box3d-wasm, and "isomorphic" only means something if
# both worlds run the same engine bytes. Bump them together.
#
#   ./scripts/build-box3d.sh [target]     -> vendor/<target>/box3d/libbox3d.a
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
. "$ROOT/scripts/host-target.sh"
TARGET="${1:-${SG_TARGET:-$(host_target)}}"

BOX3D_REPO="https://github.com/erincatto/box3d.git"
BOX3D_SHA="29bf523ce7bc4590aba9f17c9db791cdc5c4397e"   # = box3d-wasm pin

SRC="$ROOT/.deps/box3d"
DEST="$ROOT/vendor/$TARGET/box3d"

if [ ! -d "$SRC/.git" ]; then
  mkdir -p "$ROOT/.deps"
  git clone --no-checkout "$BOX3D_REPO" "$SRC"
fi
git -C "$SRC" fetch --quiet origin "$BOX3D_SHA" 2>/dev/null || git -C "$SRC" fetch --quiet
git -C "$SRC" checkout --quiet "$BOX3D_SHA"

BUILD="$SRC/build-$TARGET"
cmake -S "$SRC" -B "$BUILD" -DCMAKE_BUILD_TYPE=Release \
      -DBUILD_SHARED_LIBS=OFF \
      -DBOX3D_SAMPLES=OFF -DBOX3D_BENCHMARKS=OFF \
      -DBOX3D_UNIT_TESTS=OFF -DBOX3D_VALIDATE=OFF \
      -DCMAKE_POSITION_INDEPENDENT_CODE=ON > /dev/null
cmake --build "$BUILD" --config Release -j"$(nproc 2>/dev/null || sysctl -n hw.ncpu)" > /dev/null

mkdir -p "$DEST/include"
cp "$BUILD"/src/libbox3d.a "$DEST/" 2>/dev/null || cp "$BUILD"/libbox3d.a "$DEST/"
cp -r "$SRC/include/box3d" "$DEST/include/"
echo "$BOX3D_SHA" > "$DEST/BOX3D_SHA"

# The flat shim (the native half of the backend contract; see
# shim/sg_box3d.c). Its own archive so gen-ffi can gate the whole seam on
# one library name, the libsggl.a pattern.
CC_BIN="${CC:-cc}"
"$CC_BIN" -O2 -std=c11 -c "$ROOT/shim/sg_box3d.c" \
  -o "$BUILD/sg_box3d.o" -I "$DEST/include"
ar rcs "$DEST/libsgbox3d.a" "$BUILD/sg_box3d.o"

echo "built $DEST/libbox3d.a + libsgbox3d.a @ $BOX3D_SHA"
