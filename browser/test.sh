#!/usr/bin/env bash
# The browser proof, automated.
#
#   ./browser/test.sh            every example
#   ./browser/test.sh dodge      just one
#
# Loads each game's UNMODIFIED source into a real browser and checks that it
# renders. The one import line is redirected by an import map to
# browser/globals.js, which only re-exports real browser globals; nothing
# else is shimmed, polyfilled or rewritten.
#
# This exists because four invented APIs shipped before anyone opened a
# browser: AudioContextOrNull, window.onLoad/onMouse, canPlay(), ctx.clear()
# and the drawImageScaled/drawImageRect split. Every one passed the native
# suite and would have thrown in a page. A human noticing is not a test.
#
# Skips (exit 0) when no browser is installed, so it can live in test.sh
# without making a headless box fail. A skip is reported loudly.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ONLY="${1:-}"
PORT="${BROWSER_TEST_PORT:-8137}"

# geckodriver ships with Firefox and speaks WebDriver, which is what lets
# drive.py WAIT for a verdict instead of screenshotting a page mid-load.
if ! command -v firefox >/dev/null 2>&1; then
  echo "    SKIP (firefox not installed)"
  exit 0
fi
if ! command -v geckodriver >/dev/null 2>&1; then
  echo "    SKIP (geckodriver not installed; ships with firefox)"
  exit 0
fi

fails=0
ran=0

for gamedir in "$ROOT"/examples/*/; do
  BASE="$(basename "$gamedir")"
  [ "$BASE" = "shared" ] && continue
  [ -f "$gamedir/main.ts" ] || continue
  [ -n "$ONLY" ] && [ "$BASE" != "$ONLY" ] && continue
  ran=$((ran + 1))

  printf '  %-10s ' "$BASE"

  # Keep the build output: "FAIL (browser build)" with no reason is a
  # diagnosis-free failure, which is what this suite exists to avoid.
  if ! BUILD_OUT=$("$ROOT/browser/build.sh" "examples/$BASE" 2>&1); then
    echo "FAIL (browser build)"
    echo "$BUILD_OUT" | tail -8 | sed 's/^/      /'
    fails=$((fails + 1))
    continue
  fi

  OUT="$ROOT/browser/out"

  # web/ and host/ are the NATIVE implementation. tsc emits them because it
  # follows imports, but a page must never load them: the import map points
  # at the browser shim instead. Deleting them makes any accidental reach
  # into native code a hard 404 rather than a silent success.
  rm -rf "$OUT/web" "$OUT/host"

  W=$(python3 -c "import json;print(json.load(open('$gamedir/game.json'))['width'])")
  H=$(python3 -c "import json;print(json.load(open('$gamedir/game.json'))['height'])")
  ASSETS=$(cd "$OUT" && ls *.png 2>/dev/null | python3 -c "import sys,json;print(json.dumps([l.strip() for l in sys.stdin]))")

  sed -e "s|__W__|$W|" -e "s|__H__|$H|" \
      -e "s|__ASSETS__|$ASSETS|" \
      -e "s|__ENTRY__|/examples/$BASE/main.js|" \
      "$ROOT/browser/harness.html" > "$OUT/harness.html"

  python3 -m http.server -d "$OUT" "$PORT" >/dev/null 2>&1 &
  SERVER=$!
  # Wait for the port rather than sleeping a fixed amount.
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:$PORT/harness.html" >/dev/null 2>&1 && break
    sleep 0.1
  done

  if OUTPUT=$(python3 "$ROOT/browser/drive.py" "http://127.0.0.1:$PORT/harness.html" 45 2>&1); then
    echo "ok"
    # SG_PROOF_VERBOSE=1 shows the in-page report (frame count, distinct
    # colours) for a PASSING run, which is how you tell "rendered a real
    # scene" from "merely threw no exceptions".
    if [ -n "${SG_PROOF_VERBOSE:-}" ]; then
      echo "$OUTPUT" | sed "s/^/      /"
    fi
  elif echo "$OUTPUT" | grep -q "WebGL2 is unavailable in this browser"; then
    echo "SKIP (WebGL2 unavailable on this runner)"
  else
    echo "FAIL"
    echo "$OUTPUT"
    fails=$((fails + 1))
  fi

  kill "$SERVER" 2>/dev/null
  wait "$SERVER" 2>/dev/null
done

rm -rf "$ROOT/browser/out"

if [ "$ran" -eq 0 ]; then
  echo "    no examples matched '$ONLY'"
  exit 1
fi
exit $(( fails > 0 ? 1 : 0 ))
