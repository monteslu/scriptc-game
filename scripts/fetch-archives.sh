#!/usr/bin/env bash
# Populate vendor/<target>/ from the pinned build-libcanvas output.
#
# The skiac_* C ABI (237 declarations in skia_c.hpp) is implemented in a
# SINGLE object inside libcanvas.a: skia_c.o. That object has zero napi_*
# and zero Rust references, so it extracts cleanly and the Rust/N-API crate
# is never linked. Verified with nm; see docs/SPIKE-RESULTS.md.
set -euo pipefail
TARGET="${1:-linux-x86_64}"
SRC="${LIBCANVAS_OUT:-$HOME/code/cliemu/build-libcanvas/out/$TARGET}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/vendor/$TARGET"

[ -d "$SRC" ] || { echo "build-libcanvas output not found: $SRC" >&2; exit 1; }
mkdir -p "$DEST/skia" "$DEST/include"

cp "$SRC"/skia/*.a "$DEST/skia/"
cp "$SRC"/include/skia_c.hpp "$DEST/include/"
cp "$SRC"/CANVAS_VERSION "$DEST/" 2>/dev/null || true

# Extract skia_c.o out of libcanvas.a and re-archive it alone.
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
( cd "$work" && ar x "$SRC/libcanvas.a" )
obj="$(find "$work" -name '*skia_c.o' -print -quit)"
[ -n "$obj" ] || { echo "skia_c.o not found in libcanvas.a" >&2; exit 1; }
if nm -u "$obj" | grep -q 'napi_'; then
  echo "skia_c.o unexpectedly references napi_*; refusing" >&2; exit 1
fi
ar rcs "$DEST/libskiac.a" "$obj"

{ echo "target=$TARGET"; echo "libcanvas_src=$SRC";
  echo "skiac_symbols=$(nm --defined-only "$DEST/libskiac.a" | grep -c ' T skiac_')";
  echo "generated=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$DEST/MANIFEST"
cat "$DEST/MANIFEST"
