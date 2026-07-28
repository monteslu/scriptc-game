#!/usr/bin/env bash
# Compile the WebGL2 tier into vendor/<target>/libsggl.a
#
# SEPARATE from libsggfx.a on purpose: a 2D game must not link libGLESv2 and
# libEGL, and gen-ffi.js only adds this archive when a program actually
# imports the WebGL layer (see `usesGl` there).
#
# This exists because the archive was originally built BY HAND during the
# WebGL phase and never scripted, so it lived only on one machine. Every CI
# run since then failed with "libraries[0] cannot be read ... libsggl.a" --
# a clean clone genuinely could not build a 3D example.
set -euo pipefail
trap 'echo "build-gl.sh: failed at line $LINENO" >&2' ERR

TARGET="${1:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/$TARGET"
OBJ="$DEST/obj"
mkdir -p "$OBJ"

# SDL2 headers: sg_gl_extra.cpp creates the GL context on the SDL window.
# Same resolution order as build-shim.sh.
if [ -n "${SDL2_INCLUDE:-}" ]; then
  if [ ! -e "$SDL2_INCLUDE/SDL2" ]; then
    ln -sfn . "$SDL2_INCLUDE/SDL2" 2>/dev/null || true
  fi
  SDL_CFLAGS="-I$SDL2_INCLUDE"
  [ -d "$SDL2_INCLUDE/SDL2" ] || SDL_CFLAGS="-I$SDL2_INCLUDE -I$(dirname "$SDL2_INCLUDE")"
elif pkg-config --exists sdl2 2>/dev/null; then
  SDL_CFLAGS="$(pkg-config --cflags sdl2)"
else
  echo "SDL2 not found: install libsdl2-dev, brew install sdl2, or set SDL2_INCLUDE" >&2
  exit 1
fi

CXX_BIN="${SG_CXX:-clang++}"
INC="-I$DEST/include -I$ROOT/shim"

# GLES3, EGL and KHR headers.
#
# Linux runners get these from libgles2-mesa-dev/libegl1-mesa-dev, but
# macOS has NO GLES3 at all -- Apple deprecated OpenGL and never shipped
# ES3 headers -- so CI failed with "'GLES3/gl3.h' file not found" on both
# macOS targets while Linux built fine.
#
# shim/include carries the Khronos headers (MIT, SPDX-License-Identifier
# in each file) as a fallback. It goes LAST on the include path so a
# platform with real system headers still uses its own; these only fill a
# gap. They declare the API -- the actual GL symbols come from whatever
# the target links against.
if [ -n "${GLES_INCLUDE:-}" ]; then
  INC="$INC -I$GLES_INCLUDE"
fi
INC="$INC -I$ROOT/shim/include"

# Same dependency-file staleness check as build-shim.sh: a .d records the
# source AND every header, so touching gl3.h rebuilds what included it.
needs_build() {
  local obj="$1" dep="${1%.o}.d"
  [ -f "$obj" ] || return 0
  [ -f "$dep" ] || return 0
  local f
  for f in $(sed -e 's/^.*://' -e 's/\\$//' "$dep"); do
    [ -f "$f" ] || return 0
    [ "$f" -nt "$obj" ] && return 0
  done
  return 1
}

GL_OBJS=""
for cpp in sg_gl_gen sg_gl_extra; do
  if needs_build "$OBJ/$cpp.o"; then
    "$CXX_BIN" -O2 -std=c++17 -stdlib=libc++ -fno-exceptions -MMD \
      -c "$ROOT/shim/$cpp.cpp" -o "$OBJ/$cpp.o" $INC $SDL_CFLAGS
  fi
  GL_OBJS="$GL_OBJS $OBJ/$cpp.o"
done

NEED_AR=0
if [ ! -f "$DEST/libsggl.a" ]; then
  NEED_AR=1
else
  for f in $GL_OBJS; do
    [ "$f" -nt "$DEST/libsggl.a" ] && NEED_AR=1
  done
fi

if [ "$NEED_AR" = "1" ]; then
  rm -f "$DEST/libsggl.a"
  ar rcs "$DEST/libsggl.a" $GL_OBJS
  ranlib "$DEST/libsggl.a" 2>/dev/null || true
fi

echo "built $DEST/libsggl.a"

# A count of zero means the archive linked but exports nothing, which shows
# up much later as an undefined-symbol wall at the final link.
if command -v nm >/dev/null 2>&1; then
  N="$(nm -g --defined-only "$DEST/libsggl.a" 2>/dev/null | grep -c ' T .*sg_gl_' || true)"
  echo "  sg_gl_ symbols: $N"
  if [ "${N:-0}" = "0" ]; then
    echo "build-gl.sh: archive defines no sg_gl_ symbols" >&2
    exit 1
  fi
fi
