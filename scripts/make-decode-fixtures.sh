#!/usr/bin/env bash
# Generate the decoder test fixtures: one source, four formats.
#
# Same content through four different decode paths, so the durations and
# channel counts must agree. Requires ffmpeg; the fixtures are NOT committed
# (they are derived, and one of them is 3.9MB of music).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/examples/dodge/public/music.mp3}"
OUT="${2:-$ROOT/test/out}"

[ -f "$SRC" ] || { echo "source not found: $SRC" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ffmpeg required" >&2; exit 1; }
mkdir -p "$OUT"

ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a pcm_s16le  "$OUT/fmt.wav"
# -vn MATTERS: the source mp3 carries embedded album art, and without it
# ffmpeg muxes that image in as a Theora VIDEO stream. stb_vorbis correctly
# refuses a multiplexed file, which looks exactly like a decoder bug.
#
# libvorbis when the build has it (Linux distro ffmpeg); Homebrew's ffmpeg 8
# dropped it, leaving only the built-in encoder, which is gated behind
# -strict experimental but emits a normal Vorbis stream stb_vorbis decodes.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q '\blibvorbis\b'; then
  ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a libvorbis "$OUT/fmt.ogg"
else
  ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a vorbis -strict experimental "$OUT/fmt.ogg"
fi
ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a flac       "$OUT/fmt.flac"
ffmpeg -v error -y -i "$SRC" -t 3 -vn -c:a libmp3lame "$OUT/fmt.mp3"
echo "wrote fmt.{wav,ogg,flac,mp3} to $OUT"

# Image fixtures: one 96x64 source through five encoders, so a decoder that
# reports the right size but garbage pixels is caught by comparing them.
IMG="$ROOT/test/fixtures/images"
mkdir -p "$IMG"
ffmpeg -v error -y -f lavfi -i "testsrc=size=96x64:duration=1:rate=1" \
       -frames:v 1 "$IMG/test.png"
for f in jpg bmp gif; do
  ffmpeg -v error -y -i "$IMG/test.png" -frames:v 1 "$IMG/test.$f"
done
# webp separately: Homebrew's ffmpeg 8 dropped libwebp, so on macOS the
# encoder comes from the webp package (cwebp) instead; CI brews it.
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'webp'; then
  ffmpeg -v error -y -i "$IMG/test.png" -frames:v 1 "$IMG/test.webp"
else
  cwebp -quiet "$IMG/test.png" -o "$IMG/test.webp"
fi
echo "wrote test.{png,jpg,webp,bmp,gif} to $IMG"
