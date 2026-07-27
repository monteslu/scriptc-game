#!/usr/bin/env bash
# Build the browser proof: the SAME game source, running in a page.
#
#   ./browser/build.sh examples/dodge
#   (then serve browser/out/ and open it)
#
# What this does and does not do matters, because the whole point is the
# claim "the same source runs in both places":
#
#   - The game's .ts is TYPE-STRIPPED, not transformed. tsc with
#     target=ES2022 removes annotations and emits the same statements. No
#     bundler, no polyfill, no shimming of anything except the one import
#     line, which an import map redirects to browser/globals.js (a file
#     that does nothing but re-export real browser globals).
#
#   - Nothing is rewritten to make it work. If the page needs a patched
#     copy of the game, the claim is false and this script should fail
#     rather than paper over it.
#
# The output is a directory that can be served statically.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GAMEDIR="${1:?usage: browser/build.sh <gameDir>}"
GAMEDIR="${GAMEDIR%/}"
BASE="$(basename "$GAMEDIR")"
OUT="$ROOT/browser/out"

TSC="${TSC_BIN:-}"
if [ -z "$TSC" ]; then
  # A sibling checkout is the local layout; scriptc/ INSIDE the repo is what
  # CI produces. SCRIPTC_BIN, when set, names the compiler entry point, so
  # its package root is the most reliable hint of all.
  cands="$ROOT/node_modules/.bin/tsc $ROOT/../scriptc/node_modules/.bin/tsc $ROOT/scriptc/node_modules/.bin/tsc"
  if [ -n "${SCRIPTC_BIN:-}" ]; then
    scdir="$(cd "$(dirname "$SCRIPTC_BIN")/../../.." 2>/dev/null && pwd || true)"
    [ -n "$scdir" ] && cands="$scdir/node_modules/.bin/tsc $cands"
  fi
  for c in $cands; do
    [ -x "$c" ] && { TSC="$c"; break; }
  done
fi
[ -n "$TSC" ] || { echo "tsc not found; set TSC_BIN" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"

# Type-strip the game, the engine and the shim into out/, preserving the
# relative layout so the source's own import specifiers keep resolving.
"$TSC" \
  --target ES2022 --module ESNext --moduleResolution bundler \
  --allowImportingTsExtensions false \
  --skipLibCheck --noEmitOnError false \
  --outDir "$OUT" --rootDir "$ROOT" \
  "$GAMEDIR"/*.ts "$ROOT"/engine/*.ts \
  2>&1 | grep -vE 'error TS(2304|2307|2339|2551|2580|2584|2749|2693)' || true

# The shim is already JavaScript: copy, do not compile.
mkdir -p "$OUT/browser"
cp "$ROOT/browser/globals.js" "$OUT/browser/globals.js"

# Assets: the game directory IS the web root, same rule as native.
if [ -d "$GAMEDIR/public" ]; then
  cp -rL "$GAMEDIR/public/." "$OUT/"
fi

# The page. The import map is the ONE piece of glue: it points the game's
# "../../web/globals.js" specifier at the browser shim.
CANVAS_W=$(python3 -c "import json;print(json.load(open('$GAMEDIR/game.json'))['width'])")
CANVAS_H=$(python3 -c "import json;print(json.load(open('$GAMEDIR/game.json'))['height'])")

cat > "$OUT/index.html" <<HTML
<!doctype html>
<meta charset="utf-8">
<title>$BASE (browser)</title>
<style>
  html, body { margin: 0; height: 100%; background: #0d1117; color: #c9d1d9;
               font: 14px system-ui, sans-serif; }
  body { display: flex; flex-direction: column; align-items: center;
         justify-content: center; gap: 12px; }
  canvas { image-rendering: pixelated; max-width: 100vw; max-height: 85vh; }
  #note { opacity: .65; }
  #err { color: #f85149; font-family: ui-monospace, monospace; white-space: pre-wrap;
         max-width: 90vw; }
</style>

<canvas id="game-canvas" width="$CANVAS_W" height="$CANVAS_H"></canvas>
<div id="note">the same <code>$GAMEDIR/main.ts</code> that compiles to a native binary</div>
<div id="err"></div>

<script type="importmap">
{
  "imports": {
    "../../web/globals.js": "./browser/globals.js",
    "../web/globals.js": "./browser/globals.js"
  }
}
</script>

<script type="module">
  // Surface errors on the page: a blank canvas otherwise looks like a
  // rendering bug rather than a module that failed to load.
  const err = document.getElementById("err");
  addEventListener("error", (e) => { err.textContent += (e.message || e.error) + "\n"; });
  addEventListener("unhandledrejection", (e) => { err.textContent += e.reason + "\n"; });

  import("./$GAMEDIR/main.js")
    .then(() => {
      // The native host fires 'load' after the window exists. A page has
      // already fired it by the time a module evaluates, so re-dispatch.
      dispatchEvent(new Event("load"));
    })
    .catch((e) => { err.textContent = String(e && e.stack || e); });
</script>
HTML

echo "browser build: $OUT"
echo "  serve it:  python3 -m http.server -d $OUT 8080"
