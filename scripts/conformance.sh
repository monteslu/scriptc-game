#!/usr/bin/env bash
# Build and run the canvas conformance suite end to end.
#
#   1. build the scriptc harness
#   2. render every scene to test/out/          (no window; dummy SDL driver)
#   3. render the goldens with Node + @napi-rs/canvas at the pinned version
#   4. compare PIXELS (not PNG bytes) and fail on any difference at all
#
# Same Skia on both sides, so the bar is byte-identical. A difference is a
# real bug; never raise a tolerance to make this pass.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OUT="${1:-test/out}"
GOLD="${2:-test/golden/png}"

mkdir -p "$OUT"

echo "==> building harness"
./scripts/build.sh test/conformance.ts >/dev/null

echo "==> rendering scenes"
SDL_VIDEODRIVER=dummy ./build/conformance "$OUT"

if [ ! -d test/golden/node_modules ]; then
  echo "==> installing the golden reference (@napi-rs/canvas)"
  ( cd test/golden && npm install --silent )
fi

echo "==> rendering goldens"
( cd test/golden && node render-goldens.mjs "$ROOT/$GOLD" )

echo "==> comparing"
node test/golden/compare.mjs "$OUT" "$GOLD"
