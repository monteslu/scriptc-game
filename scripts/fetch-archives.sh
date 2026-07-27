#!/usr/bin/env bash
# Populate vendor/<target>/ from the pinned build-libcanvas output.
#
# The skiac_* C ABI (237 declarations in skia_c.hpp) is implemented in a
# SINGLE object inside libcanvas.a: skia_c.o. That object has zero napi_*
# and zero Rust references, so it extracts cleanly and the Rust/N-API crate
# is never linked. Verified with nm; see docs/SPIKE-RESULTS.md.
set -euo pipefail
TARGET="${1:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/$TARGET"
SRC="${LIBCANVAS_OUT:-$HOME/code/cliemu/build-libcanvas/out/$TARGET}"

# A local build-libcanvas checkout wins when present (that is the inner-loop
# case, and it picks up unreleased changes). Otherwise download the pinned
# release: CI runners have no checkout, and requiring one would mean every
# platform in the matrix builds Skia from source for no reason.
if [ ! -d "$SRC" ]; then
  # Parsed with sed rather than python3: on Windows runners the shell is
  # MSYS bash but python3 is a native Windows build, so it cannot open the
  # "/d/a/..." path this script computes. One less toolchain in the way.
  TAG="${LIBCANVAS_TAG:-$(sed -n 's/.*"release_tag"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$ROOT/versions.json" | head -1)}"
  [ -n "$TAG" ] || { echo "no local build-libcanvas at $SRC and no canvas.release_tag in versions.json" >&2; exit 1; }
  URL="https://github.com/monteslu/build-libcanvas/releases/download/$TAG/libcanvas-$TARGET.tar.gz"
  echo "fetching $URL"
  DL="$(mktemp -d)"; trap 'rm -rf "$DL"' EXIT
  curl -fsSL "$URL" -o "$DL/a.tar.gz" || { echo "download failed: $URL" >&2; exit 1; }
  mkdir -p "$DL/x" && tar -xzf "$DL/a.tar.gz" -C "$DL/x"
  # The tarball may or may not carry a top-level directory.
  SRC="$DL/x"
  # `find -printf` is GNU-only; BSD find (macOS) has no such flag. dirname
  # of the first match is portable.
  if [ ! -f "$SRC/libcanvas.a" ]; then
    hit="$(find "$DL/x" -maxdepth 2 -name libcanvas.a | head -1)"
    [ -n "$hit" ] && SRC="$(dirname "$hit")"
  fi
  [ -n "$SRC" ] && [ -d "$SRC" ] || { echo "libcanvas.a not found in $URL" >&2; exit 1; }
fi

[ -d "$SRC" ] || { echo "build-libcanvas output not found: $SRC" >&2; exit 1; }
mkdir -p "$DEST/skia" "$DEST/include"

cp "$SRC"/skia/*.a "$DEST/skia/"
cp "$SRC"/include/skia_c.hpp "$DEST/include/"
cp "$SRC"/CANVAS_VERSION "$DEST/" 2>/dev/null || true

# Counting exported skiac_* symbols is the sanity check that the extraction
# worked, and it has to survive TWO nm dialects: GNU nm wants
# --defined-only, BSD nm (macOS) wants -U, and Mach-O prefixes every C
# symbol with an underscore so the name is _skiac_ there. Getting this wrong
# reports 0 and the link then fails a step later with no explanation.
count_skiac() {
  { nm --defined-only "$1" 2>/dev/null || nm -U "$1" 2>/dev/null || nm "$1"; } \
    | grep -cE ' T _?skiac_'
}

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
  echo "skiac_symbols=$(count_skiac "$DEST/libskiac.a")";
  echo "generated=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$DEST/MANIFEST"
cat "$DEST/MANIFEST"
