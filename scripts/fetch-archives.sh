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
  # of the first match is portable. The Windows build names the same
  # archives .lib rather than .a, though they are ordinary ar archives.
  if [ ! -f "$SRC/libcanvas.a" ] && [ ! -f "$SRC/libcanvas.lib" ]; then
    hit="$(find "$DL/x" -maxdepth 2 \( -name libcanvas.a -o -name libcanvas.lib \) | head -1)"
    [ -n "$hit" ] && SRC="$(dirname "$hit")"
  fi
  [ -n "$SRC" ] && [ -d "$SRC" ] || { echo "libcanvas archive not found in $URL" >&2; exit 1; }
fi

[ -d "$SRC" ] || { echo "build-libcanvas output not found: $SRC" >&2; exit 1; }
mkdir -p "$DEST/skia" "$DEST/include"

# build-libcanvas names these .lib on Windows and .a everywhere else. They
# are ordinary ar archives either way, so the only difference is the
# extension: normalise to .a here and nothing downstream has to care.
CANVAS_AR="$SRC/libcanvas.a"
[ -f "$CANVAS_AR" ] || CANVAS_AR="$SRC/libcanvas.lib"
[ -f "$CANVAS_AR" ] || { echo "no libcanvas.a or libcanvas.lib in $SRC" >&2; exit 1; }

copied=0
for f in "$SRC"/skia/*.a "$SRC"/skia/*.lib; do
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  case "$base" in
    *.lib) base="lib${base%.lib}.a" ;;    # foo.lib -> libfoo.a
  esac
  cp "$f" "$DEST/skia/$base"
  copied=$((copied + 1))
done
[ "$copied" -gt 0 ] || { echo "no skia archives found in $SRC/skia" >&2; exit 1; }

cp "$SRC"/skia/icudtl.dat "$DEST/skia/" 2>/dev/null || true
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

# Extract skia_c.o out of the canvas archive and re-archive it alone.
#
# The Windows archive stores members under their full build path
# ("D:/a/.../skia_c.o"), and GNU ar refuses those: it reads the slashes as
# directories and reports "No such file or directory" for every member.
# llvm-ar handles them, so it is preferred when present; otherwise a small
# reader pulls out just the member we want. Nothing else in this script
# needs the other thousands of members.
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT

# llvm-ar handles path-like member names; GNU ar does not, and the Windows
# archive stores every member under its full build path. Try the archivers
# first, then fall back to reading the format directly.
obj=""
for cand in llvm-ar llvm-ar-18 llvm-ar-17 ar; do
  command -v "$cand" >/dev/null 2>&1 || continue
  ( cd "$work" && "$cand" x "$CANVAS_AR" >/dev/null 2>&1 ) || true
  obj="$(find "$work" \( -name '*skia_c.o' -o -name '*skia_c.obj' \) -print 2>/dev/null | head -1)"
  [ -n "$obj" ] && break
  rm -rf "${work:?}"/* 2>/dev/null || true
done

if [ -z "$obj" ]; then
  python3 "$(dirname "$0")/ar-extract.py" "$CANVAS_AR" "$work/skia_c.o" \
    skia_c.o skia_c.obj >&2 || true
  obj="$(find "$work" -name 'skia_c.o' -print 2>/dev/null | head -1)"
fi

[ -n "$obj" ] || { echo "skia_c.o not found in libcanvas.a" >&2; exit 1; }
if nm -u "$obj" | grep -q 'napi_'; then
  echo "skia_c.o unexpectedly references napi_*; refusing" >&2; exit 1
fi
ar rcs "$DEST/libskiac.a" "$obj"

{ echo "target=$TARGET"; echo "libcanvas_src=$SRC";
  echo "skiac_symbols=$(count_skiac "$DEST/libskiac.a")";
  echo "generated=$(date -u +%Y-%m-%dT%H:%M:%SZ)"; } > "$DEST/MANIFEST"
cat "$DEST/MANIFEST"
