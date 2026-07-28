#!/usr/bin/env bash
# Compile the shim and merge it with Skia into vendor/<target>/libsggfx.a
#
# ONE archive on purpose. Skia's ~28 archives are mutually dependent and GNU
# ld takes each archive exactly once, left to right; the FFI manifest is a
# flat, duplicate-rejecting path list, so link order cannot be expressed
# there. Within a single archive the linker iterates to a fixpoint, so
# merging every member sidesteps the ordering problem completely.
set -euo pipefail
# `set -e` exits with no indication of WHERE. On a CI runner this script
# died after `ar` with an empty log; a trap names the line instead.
trap 'echo "build-shim.sh: failed at line $LINENO" >&2' ERR
TARGET="${1:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/$TARGET"
OBJ="$DEST/obj"
mkdir -p "$OBJ"

# SDL2 headers. pkg-config is the norm on Linux and macOS; the Windows
# runner unpacks the official VC release, and the Android NDK sysroot has
# no pkg-config at all, so both pass a directory instead.
if [ -n "${SDL2_INCLUDE:-}" ]; then
  # The shim includes <SDL2/SDL.h>, which is how distributions lay it out.
  # The upstream VC zip and source release put the headers at the root of
  # include/ instead, so a shim built against those would need every include
  # rewritten. A symlinked SDL2 -> . inside the include dir satisfies both
  # spellings and leaves the source alone.
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

# Cross-compiling to Android goes through the NDK's clang, which already
# knows its own sysroot; everything else uses the host compiler.
CC_BIN="${SG_CC:-clang}"
CXX_BIN="${SG_CXX:-clang++}"
INC="-I$DEST/include -I$ROOT/shim -I${WEBAUDIO_SRC:-$HOME/code/cliemu/webaudio-node}/src/vendor"

# sg_core is C++ (skiac is a C ABI over a C++ library and the shim uses
# extern "C" blocks); sg_tables is plain C.
#
# -stdlib=libc++ is REQUIRED: build-libcanvas builds Skia against LLVM's
# libc++, so every std:: symbol in the vendored archives is std::__1::.
# Compiling the shim against libstdc++ would mismatch the ABI at the
# skia_c.hpp boundary; the final link takes -lc++ -lc++abi (see gen-ffi.js).
# Recompile only what changed.
#
# These seven translation units took 5.8s on EVERY build, including builds
# where no C++ had been touched -- roughly half the edit-to-run latency for
# someone iterating on game code, which is the common case.
#
# Staleness is judged against the .d file clang writes with -MMD: that lists
# the source AND every header it pulled in, so editing sg_skia.h correctly
# rebuilds each dependent object. A missing .d means "never built", which
# compiles. Deleting obj/ forces a full rebuild.
needs_build() {
  local obj="$1" dep="${1%.o}.d"
  [ -f "$obj" ] || return 0            # never built
  [ -f "$dep" ] || return 0            # no dependency record: assume stale
  local f
  # Strip make-rule syntax (target:, line continuations) to get the file list.
  for f in $(sed -e 's/^.*://' -e 's/\\$//' "$dep"); do
    [ -f "$f" ] || return 0            # a dependency vanished
    [ "$f" -nt "$obj" ] && return 0    # a dependency is newer
  done
  return 1
}

if needs_build "$OBJ/sg_tables.o"; then
  "$CC_BIN" -O2 -std=c11 -MMD -c "$ROOT/shim/sg_tables.c" -o "$OBJ/sg_tables.o" $INC
fi

SHIM_OBJS="$OBJ/sg_tables.o"
for cpp in sg_core sg_input sg_audio sg_audio_decode sg_skia_gen sg_skia_extra; do
  if needs_build "$OBJ/$cpp.o"; then
    "$CXX_BIN" -O2 -std=c++17 -stdlib=libc++ -fno-exceptions -MMD \
            -c "$ROOT/shim/$cpp.cpp" -o "$OBJ/$cpp.o" $INC $SDL_CFLAGS
  fi
  SHIM_OBJS="$SHIM_OBJS $OBJ/$cpp.o"
done

# Skip the expensive merge when every input is older than the output.
NEED_MERGE=0
if [ ! -f "$DEST/libsggfx.a" ]; then
  NEED_MERGE=1
else
  for f in $SHIM_OBJS "$DEST/libskiac.a"; do
    [ "$f" -nt "$DEST/libsggfx.a" ] && NEED_MERGE=1
  done
fi

if [ "$NEED_MERGE" = "1" ]; then
  MERGE="$OBJ/merge"
  rm -rf "$MERGE"; mkdir -p "$MERGE"
  (
    cd "$MERGE"
    for a in "$DEST"/libskiac.a "$DEST"/skia/*.a; do
      # Members can share basenames across archives, so give each archive
      # its own subdirectory and extraction cannot clobber.
      sub="$(basename "$a" .a)"
      mkdir -p "$sub"
      ( cd "$sub" && ar x "$a" )
    done
  )
  rm -f "$DEST/libsggfx.a"
  # A single ar command line would overflow with thousands of members, so
  # append in batches and build the index once at the end.
  # `q` appends; GNU ar takes S to skip the symbol index (built once at the
  # end by ranlib), which BSD ar on macOS does not accept. Try the fast form
  # and fall back rather than assuming a toolchain.
  AR_APPEND="qS"
  ar qS "$DEST/libsggfx.a" $SHIM_OBJS 2>/dev/null || {
    AR_APPEND="q"
    rm -f "$DEST/libsggfx.a"
    ar q "$DEST/libsggfx.a" $SHIM_OBJS || {
      echo "ar: could not append shim objects to libsggfx.a" >&2; exit 1; }
  }
  find "$MERGE" -name '*.o' -print0 \
    | xargs -0 -n 300 ar "$AR_APPEND" "$DEST/libsggfx.a" || {
        echo "ar: could not append Skia members to libsggfx.a" >&2; exit 1; }
  ranlib "$DEST/libsggfx.a" || { echo "ranlib failed" >&2; exit 1; }
  rm -rf "$MERGE"
else
  # Shim objects changed but Skia did not: replace just those members.
  ar r "$DEST/libsggfx.a" $SHIM_OBJS
  ranlib "$DEST/libsggfx.a"
fi

echo "built $DEST/libsggfx.a"

# Symbol counts are INFORMATIONAL, and must never fail the build.
#
# Two ways this bit before: GNU nm wants --defined-only while BSD nm (macOS)
# wants -U, and Mach-O prefixes C symbols with an underscore so the names
# are _sg_ / _skiac_ there. On macOS the flag was rejected, grep -c matched
# nothing, and `set -e` turned a progress message into a build failure with
# an empty log.
count_syms() {
  { nm --defined-only "$1" 2>/dev/null || nm -U "$1" 2>/dev/null || nm "$1" 2>/dev/null; } \
    | grep -cE " T _?$2" || true
}
echo "  sg_ symbols: $(count_syms "$DEST/libsggfx.a" 'sg_')"
echo "  skiac_ symbols: $(count_syms "$DEST/libsggfx.a" 'skiac_')"
