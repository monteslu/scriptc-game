#!/usr/bin/env bash
# Compile the shim and merge it with Skia into vendor/<target>/libsggfx.a
#
# ONE archive on purpose. Skia's ~28 archives are mutually dependent and GNU
# ld takes each archive exactly once, left to right; the FFI manifest is a
# flat, duplicate-rejecting path list, so link order cannot be expressed
# there. Within a single archive the linker iterates to a fixpoint, so
# merging every member sidesteps the ordering problem completely.
set -euo pipefail
TARGET="${1:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$ROOT/vendor/$TARGET"
OBJ="$DEST/obj"
mkdir -p "$OBJ"

SDL_CFLAGS="$(pkg-config --cflags sdl2)"
INC="-I$DEST/include -I$ROOT/shim -I${WEBAUDIO_SRC:-$HOME/code/cliemu/webaudio-node}/src/vendor"

# sg_core is C++ (skiac is a C ABI over a C++ library and the shim uses
# extern "C" blocks); sg_tables is plain C.
#
# -stdlib=libc++ is REQUIRED: build-libcanvas builds Skia against LLVM's
# libc++, so every std:: symbol in the vendored archives is std::__1::.
# Compiling the shim against libstdc++ would mismatch the ABI at the
# skia_c.hpp boundary; the final link takes -lc++ -lc++abi (see gen-ffi.js).
clang -O2 -std=c11 -c "$ROOT/shim/sg_tables.c" -o "$OBJ/sg_tables.o" $INC

SHIM_OBJS="$OBJ/sg_tables.o"
for cpp in sg_core sg_input sg_audio sg_audio_decode sg_skia_gen sg_skia_extra; do
  clang++ -O2 -std=c++17 -stdlib=libc++ -fno-exceptions \
          -c "$ROOT/shim/$cpp.cpp" -o "$OBJ/$cpp.o" $INC $SDL_CFLAGS
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
  ar qS "$DEST/libsggfx.a" $SHIM_OBJS
  find "$MERGE" -name '*.o' -print0 | xargs -0 -n 300 ar qS "$DEST/libsggfx.a"
  ranlib "$DEST/libsggfx.a"
  rm -rf "$MERGE"
else
  # Shim objects changed but Skia did not: replace just those members.
  ar r "$DEST/libsggfx.a" $SHIM_OBJS
  ranlib "$DEST/libsggfx.a"
fi

echo "built $DEST/libsggfx.a"
nm --defined-only "$DEST/libsggfx.a" 2>/dev/null | grep -c ' T sg_' | sed 's/^/  sg_ symbols: /'
nm --defined-only "$DEST/libsggfx.a" 2>/dev/null | grep -c ' T skiac_' | sed 's/^/  skiac_ symbols: /'
