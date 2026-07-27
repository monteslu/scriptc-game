#!/usr/bin/env bash
# Compile webaudio-node's C++ graph core into vendor/<target>/libwebaudio.a.
#
# The source is FETCHED, not vendored (versions.json pins it), and compiled
# byte-identical: shim/emscripten.h supplies the one symbol the engine wants
# from emscripten (the KEEPALIVE attribute), so no upstream file is patched.
# That keeps a webaudio-node bump a re-fetch rather than a re-port, and it is
# what makes the Phase 4.5 parity test meaningful -- both sides run the same
# code, not a fork.
#
# Decoders: dr_wav/dr_mp3/dr_flac and stb_vorbis are header-only and come
# along for free. Opus and AAC (libxaac) are NOT built: they are ~600 source
# files of codec, and games ship wav/ogg. Adding them later is a matter of
# extending CODEC_SOURCES.
set -euo pipefail
TARGET="${1:-linux-x86_64}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${WEBAUDIO_SRC:-$HOME/code/cliemu/webaudio-node}"
DEST="$ROOT/vendor/$TARGET"
OBJ="$DEST/obj/webaudio"

[ -d "$SRC/src/wasm" ] || { echo "webaudio-node source not found: $SRC" >&2; exit 1; }

mkdir -p "$OBJ"

# -I$ROOT/shim FIRST so our emscripten.h wins over any real one on the box.
INCLUDES="-I$ROOT/shim -I$SRC -I$SRC/src/vendor"

# audio_graph_simple.cpp uses std::string without including <string>; it
# compiles anyway wherever <map> happens to pull the definition in
# transitively, and fails where it does not (libstdc++ 12 on the CI
# runners). Forced in from the command line rather than patched, so the
# upstream source stays byte-identical -- see the note at the top.
INCLUDES="$INCLUDES -include string"

# Matches the shim's own flags: libc++ for ABI compatibility with Skia, and
# no exceptions (the engine uses none -- verified, zero try/throw/catch).
CXXFLAGS="-O2 -std=c++17 -stdlib=libc++ -fno-exceptions -fvisibility=hidden -DNDEBUG"

# This list MIRRORS upstream's scripts/build-unified-real.sh exactly, which
# matters more than it looks: src/wasm/webaudio.cpp is a single-module
# AMALGAMATION that re-defines every node and util, so linking it alongside
# the individual files is a wall of duplicate-symbol errors. Upstream builds
# the individual files; so do we, and the parity test then compares like
# with like.
#
# NOTE: src/wasm/audio_decoders.cpp is deliberately NOT in this list. It
# hard-includes opusfile and libxaac headers with no #ifdef guard, so it
# cannot build without those two codec trees (~600 source files). Decoding
# lives in shim/sg_audio_decode.cpp instead, which uses the SAME header-only
# libraries (dr_wav/dr_mp3/dr_flac, stb_vorbis) that upstream uses for
# everything except opus and aac.
SOURCES="
  src/wasm/utils/fft.cpp
  src/wasm/utils/audio_param.cpp
  src/wasm/nodes/oscillator_node.cpp
  src/wasm/nodes/gain_node.cpp
  src/wasm/nodes/buffer_source_node.cpp
  src/wasm/nodes/biquad_filter_node.cpp
  src/wasm/nodes/delay_node.cpp
  src/wasm/nodes/wave_shaper_node.cpp
  src/wasm/nodes/stereo_panner_node.cpp
  src/wasm/nodes/constant_source_node.cpp
  src/wasm/nodes/convolver_node.cpp
  src/wasm/nodes/dynamics_compressor_node.cpp
  src/wasm/nodes/analyser_node.cpp
  src/wasm/nodes/panner_node.cpp
  src/wasm/nodes/iir_filter_node.cpp
  src/wasm/nodes/channel_splitter_node.cpp
  src/wasm/nodes/channel_merger_node.cpp
  src/wasm/audio_graph_simple.cpp
  src/wasm/media_stream_source.cpp
"

OBJS=""
for rel in $SOURCES; do
  [ -f "$SRC/$rel" ] || { echo "missing source: $rel" >&2; exit 1; }
  out="$OBJ/$(echo "$rel" | tr '/' '_' | sed 's/\.cpp$/.o/')"
  if [ ! -f "$out" ] || [ "$SRC/$rel" -nt "$out" ]; then
    echo "  cc $rel"
    clang++ $CXXFLAGS $INCLUDES -c "$SRC/$rel" -o "$out"
  fi
  OBJS="$OBJS $out"
done

rm -f "$DEST/libwebaudio.a"
ar rcs "$DEST/libwebaudio.a" $OBJS
echo "built $DEST/libwebaudio.a"
# Informational only, and must not fail the build: BSD nm (macOS) rejects
# --defined-only, after which grep -c matches nothing and `set -e` kills a
# progress message. Same trap as build-shim.sh and fetch-archives.sh.
echo "  exported symbols: $(
  { nm --defined-only "$DEST/libwebaudio.a" 2>/dev/null \
    || nm -U "$DEST/libwebaudio.a" 2>/dev/null \
    || nm "$DEST/libwebaudio.a" 2>/dev/null; } | grep -c ' T ' || true)"
