#!/usr/bin/env bash
# Generate the decoder test fixtures: one source, four formats.
#
# Same content through four different decode paths, so the durations and
# channel counts must agree. Requires ffmpeg; the fixtures are NOT committed
# (they are derived, and one of them is 3.9MB of music).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/examples/dodge/assets/music.mp3}"
OUT="${2:-$ROOT/test/out}"

[ -f "$SRC" ] || { echo "source not found: $SRC" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg required" >&2; exit 1; }
mkdir -p "$OUT"

ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a pcm_s16le  "$OUT/fmt.wav"
# -vn MATTERS: the source mp3 carries embedded album art, and without it
# ffmpeg muxes that image in as a Theora VIDEO stream. stb_vorbis correctly
# refuses a multiplexed file, which looks exactly like a decoder bug.
ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a libvorbis  "$OUT/fmt.ogg"
ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a flac       "$OUT/fmt.flac"
ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a libmp3lame "$OUT/fmt.mp3"
echo "wrote fmt.{wav,ogg,flac,mp3} to $OUT"
