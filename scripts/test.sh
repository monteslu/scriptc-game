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
for entry in test/conformance.ts test/readbackprobe.ts test/inputtest.ts test/padvisual.ts test/audiotest.ts; do
  ./scripts/build.sh "$entry" >/dev/null || { echo "build failed: $entry"; exit 1; }
done

run "canvas conformance" ./scripts/conformance.sh
run "pixel readback"     env SDL_VIDEODRIVER=dummy ./build/readbackprobe
run "input + gamepads"   env SDL_VIDEODRIVER=dummy ./build/inputtest
run "pad visual"         env SDL_VIDEODRIVER=dummy ./build/padvisual test/out/padvisual.png
# Audio runs OFFLINE (no device): renders graphs to float WAVs and checks the
# samples. test/beeptest.ts is the live-device check and is deliberately not
# here -- it needs a sound card and makes noise.
run "audio graph"        env SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy ./build/audiotest test/out

echo
if [ "$fails" -eq 0 ]; then
  echo "all suites passed"
else
  echo "$fails suite(s) failed"
fi
exit "$fails"
