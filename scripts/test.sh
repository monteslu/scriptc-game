#!/usr/bin/env bash
# Build and run every automated check. Exits non-zero if any fails.
#
#   canvas conformance   55 scenes, pixel-compared against napi-rs/canvas
#   readback             getImageData values (a golden compare cannot see these)
#   input                gamepad mapping/axes/hot-plug via a virtual controller
#   padvisual            proves pad state reaches the screen, not just the API
#
# Everything runs headless (SDL_VIDEODRIVER=dummy), so this lane needs no
# display, no window manager, and no physical hardware.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Test programs must link the SAME per-target archives the examples do.
# Without this every suite built against vendor/linux-x86_64 regardless of
# the host, which fails on any other architecture with a bare
# "ar: .../linux-x86_64/libskiac.a: No such file or directory".
TARGET="${SG_TARGET:-linux-x86_64}"
export SG_TARGET="$TARGET"     # inherited by conformance.sh and every child
cd "$ROOT"

mkdir -p test/out
fails=0

run() {
  local name="$1"; shift
  echo
  echo "==> $name"
  if "$@"; then
    echo "    PASS"
  else
    echo "    FAIL"
    fails=$((fails + 1))
  fi
}

echo "==> building test programs"
for entry in test/conformance.ts test/readbackprobe.ts test/inputtest.ts test/padvisual.ts test/audiotest.ts test/decodetest.ts test/imagetest.ts test/spritetest.ts test/asynctest.ts test/missileprobe.ts test/websurface.ts; do
  ./scripts/build.sh "$entry" "$TARGET" >/dev/null || { echo "build failed: $entry"; exit 1; }
done

run "canvas conformance" ./scripts/conformance.sh
run "pixel readback"     env SDL_VIDEODRIVER=dummy ./build/readbackprobe
run "input + gamepads"   env SDL_VIDEODRIVER=dummy ./build/inputtest
run "pad visual"         env SDL_VIDEODRIVER=dummy ./build/padvisual test/out/padvisual.png
run "sprite sheets"      env SDL_VIDEODRIVER=dummy ./build/spritetest test/out
# Event-loop ordering: async-shaped APIs must settle on a LATER turn. Guards
# the class of bug where a promise chain silently never runs.
# Every game-visible global must be a REAL web API. Guards against inventing
# conveniences that work natively and throw in a browser.
run "web surface"        env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ./build/websurface
run "async ordering"     env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ./build/asynctest
# Example game mechanics. An idle screenshot exercises none of the shooting
# code, so the rules are asserted directly instead.
run "missile mechanics"  env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ./build/missileprobe
# Audio runs OFFLINE (no device): renders graphs to float WAVs and checks the
# samples. test/beeptest.ts is the live-device check and is deliberately not
# here -- it needs a sound card and makes noise.
run "audio graph"        env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ./build/audiotest test/out

# Decoder fixtures are DERIVED (one source, four formats) and not committed,
# so regenerate them when ffmpeg is available and skip the suite when not.
if command -v ffmpeg >/dev/null 2>&1; then
  ./scripts/make-decode-fixtures.sh >/dev/null
  run "audio decoders"     env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ./build/decodetest test/out
  run "image formats"      env SDL_VIDEODRIVER=dummy ./build/imagetest test/fixtures/images test/out
else
  echo; echo "==> audio decoders"; echo "    SKIP (ffmpeg not installed)"
fi

# The browser proof: does the SAME game source run in a real browser?
#
# Native suites cannot catch an invented API -- AudioContextOrNull,
# window.onLoad, canPlay(), ctx.clear() and the drawImage arity split all
# passed everything above while being guaranteed TypeErrors in a page.
# Skips loudly when firefox/geckodriver are absent.
echo
echo "==> browser proof"
if "$ROOT/browser/test.sh"; then
  echo "    PASS"
else
  echo "    FAIL"
  fails=$((fails + 1))
fi

echo
if [ "$fails" -eq 0 ]; then
  echo "all suites passed"
else
  echo "$fails suite(s) failed"
fi
exit "$fails"
