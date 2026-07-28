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
# which the linker copies verbatim into every binary. The result only
# resolves if the process happens to be run from the directory holding the
# dylibs, so the build would link cleanly and then fail at startup with
# "image not found" anywhere else.
#
# Absolute paths are correct here because these live in the build tree and
# the binaries that use them are run from it. A redistributable build would
# want @rpath and a matching -rpath instead.
if command -v install_name_tool >/dev/null 2>&1; then
  for f in "$DEST"/lib/*.dylib; do
    install_name_tool -id "$f" "$f" 2>/dev/null || true
  done
  # ...and the cross-references between them: libGLESv2 pulls in libEGL.
  for f in "$DEST"/lib/*.dylib; do
    for dep in $(otool -L "$f" 2>/dev/null | awk 'NR>1 {print $1}' | grep '^\./' || true); do
      base="$(basename "$dep")"
      [ -f "$DEST/lib/$base" ] && install_name_tool -change "$dep" "$DEST/lib/$base" "$f" 2>/dev/null || true
    done
  done
fi

echo "angle: installed into $DEST"
echo "  export ANGLE_LIB=$DEST/lib"
echo "  export GLES_INCLUDE=$DEST/include"
