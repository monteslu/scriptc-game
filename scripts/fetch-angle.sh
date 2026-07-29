#!/usr/bin/env bash
# Download prebuilt ANGLE for macOS into vendor/<target>/angle/
#
# WHY. Apple deprecated OpenGL and never shipped GLES3 headers or
# libraries, so a 3D game cannot link on macOS at all: every macOS CI run
# failed at the link step even after the Khronos headers were vendored,
# because there is no libGLESv2/libEGL to link against.
#
# ANGLE is the standard answer. It translates GLES3 onto Metal, it is what
# Chrome ships, and it is what native-gles already uses for exactly this
# problem -- so this script deliberately pulls the same prebuilt archives
# from kivy/angle-builder rather than inventing a second source of truth.
#
# ANGLE is BSD-licensed (the archive carries its LICENSE).
#
# Linux and Android use the system EGL/GLES and skip this entirely.
set -euo pipefail
trap 'echo "fetch-angle.sh: failed at line $LINENO" >&2' ERR

TARGET="${1:-macos-aarch64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/$TARGET/angle"

case "$TARGET" in
  macos-aarch64) ARCH=arm64 ;;
  macos-x86_64)  ARCH=x64 ;;
  *)
    echo "fetch-angle.sh: $TARGET uses system GLES; nothing to fetch"
    exit 0
    ;;
esac

# Pinned, matching native-gles's package.json config.angle.kivy_tag: a
# floating tag would make a green build silently become a red one.
TAG="chromium-7151_rev1"
URL="https://github.com/kivy/angle-builder/releases/download/${TAG}/angle-macos-${ARCH}.tar.gz"

if [ -f "$DEST/lib/libGLESv2.dylib" ] && [ -f "$DEST/lib/libEGL.dylib" ]; then
  echo "angle: already present in $DEST"
  exit 0
fi

echo "angle: fetching $URL"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

curl -fsSL --retry 3 --max-time 600 -o "$TMP/angle.tar.gz" "$URL"
mkdir -p "$TMP/x" "$DEST/lib" "$DEST/include"
tar xzf "$TMP/angle.tar.gz" -C "$TMP/x"

# The archive puts the dylibs at its root and the headers in include/.
find "$TMP/x" -maxdepth 2 -name '*.dylib' -exec cp {} "$DEST/lib/" \;
if [ -d "$TMP/x/include" ]; then
  cp -R "$TMP/x/include/." "$DEST/include/"
fi
[ -f "$TMP/x/LICENSE" ] && cp "$TMP/x/LICENSE" "$DEST/ANGLE-LICENSE"

if [ ! -f "$DEST/lib/libGLESv2.dylib" ] || [ ! -f "$DEST/lib/libEGL.dylib" ]; then
  echo "fetch-angle.sh: archive did not contain libGLESv2/libEGL" >&2
  exit 1
fi

# REWRITE THE INSTALL NAMES to absolute paths.
#
# The archive ships them as "./libGLESv2.dylib" -- a RELATIVE install name,
# which the linker copies verbatim into every binary. The result links
# cleanly and then dies at startup with
#
#   dyld: Library not loaded: ./libGLESv2.dylib
#
# ...which is exactly what CI hit. Absolute paths are correct here because
# these live in the build tree and the binaries are run from it; a
# redistributable build would want @rpath instead.
#
# NOT silenced. The first version wrapped every call in `2>/dev/null ||
# true`, so when the rewrite failed the script still printed "installed"
# and the failure only surfaced as a dyld abort three steps later.
#
# On Apple silicon a dylib carries a code signature that install_name_tool
# invalidates, and the tool refuses to touch a signed binary. Stripping the
# signature first is what makes the rewrite possible; these are build-tree
# libraries loaded by locally-built binaries, so an ad-hoc signature is
# reapplied afterwards to keep dyld happy.
if ! command -v install_name_tool >/dev/null 2>&1; then
  echo "fetch-angle.sh: install_name_tool not found (needs Xcode CLT)" >&2
  exit 1
fi

# The rewrite can FAIL on a machine with only the Command Line Tools: their
# install_name_tool refuses the post-codesign __LINKEDIT layout, and the
# prebuilts ship with no header padding, so the longer absolute name has
# nowhere to go. That is not fatal -- build.sh rewrites the BINARY's load
# commands after every link, which works everywhere -- so a failed rewrite
# restores the pristine dylibs and moves on rather than killing the fetch.
REWRITE_OK=1
for f in "$DEST"/lib/*.dylib; do
  codesign --remove-signature "$f" 2>/dev/null || true
  if ! install_name_tool -id "$f" "$f" 2>/dev/null; then
    REWRITE_OK=0
    break
  fi
done

# ...and the cross-references between them: libGLESv2 pulls in libEGL.
if [ "$REWRITE_OK" = 1 ]; then
  for f in "$DEST"/lib/*.dylib; do
    deps="$(otool -L "$f" | awk 'NR>1 {print $1}' | grep -E '^(\./|@)' || true)"
    for dep in $deps; do
      base="$(basename "$dep")"
      if [ -f "$DEST/lib/$base" ]; then
        if ! install_name_tool -change "$dep" "$DEST/lib/$base" "$f" 2>/dev/null; then
          REWRITE_OK=0
        fi
      fi
    done
    # Re-sign ad hoc: dyld rejects a modified, still-signed image otherwise.
    codesign --force --sign - "$f" 2>/dev/null || true
  done
fi

if [ "$REWRITE_OK" = 0 ]; then
  cp "$TMP/x"/*.dylib "$DEST/lib/"
  echo "angle: install_name_tool cannot rewrite these dylibs (CLT-only" >&2
  echo "angle: toolchain); keeping them pristine. build.sh's post-link" >&2
  echo "angle: fixup makes built binaries resolve them absolutely." >&2
else
  # VERIFY, rather than trust: a rewrite that silently did nothing is the
  # whole reason this failed the first time.
  for f in "$DEST"/lib/*.dylib; do
    id="$(otool -D "$f" | tail -1)"
    case "$id" in
      /*) ;;
      *)
        echo "fetch-angle.sh: $f still has a relative install name '$id'" >&2
        exit 1
        ;;
    esac
  done
fi

echo "angle: installed into $DEST"
echo "  export ANGLE_LIB=$DEST/lib"
echo "  export GLES_INCLUDE=$DEST/include"
