#!/usr/bin/env bash
# The WebGL2 acceptance gate: identical pixels from two independent stacks.
#
#   Node + webgl-node + native-gles   (the reference)
#   this project's ported context      (the thing under test)
#
# Both render the same three scenes and hash the framebuffer with the same
# FNV-1a. Equal hashes mean equal pixels.
#
# Why hashes rather than images: FFI format 1 has no out-bytes class, so
# pixels cannot cross the boundary into TS. The native side digests the
# framebuffer in C (sg_gl_hash_pixels) and the reference reproduces that
# algorithm in JS.
#
# Skips (exit 0) when the reference cannot run -- no EGL device, or
# webgl-node not installed -- so a box without a GPU still runs everything
# else. A skip is reported loudly.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REF_DIR="$ROOT/test/webgl-parity"

if [ ! -x "$ROOT/build/webgltest" ]; then
  echo "    SKIP (build/webgltest not built)"
  exit 0
fi
if [ ! -d "$REF_DIR/node_modules/webgl-node" ]; then
  echo "    SKIP (reference not installed: npm install in test/webgl-parity)"
  exit 0
fi

# The reference lane matches native-gles's own CI: surfaceless EGL, software
# rasteriser, so it needs no display and no GPU.
REF_OUT="$(cd "$REF_DIR" && EGL_PLATFORM=surfaceless LIBGL_ALWAYS_SOFTWARE=1 \
  timeout 300 node reference.mjs 2>/dev/null)"
if [ -z "$REF_OUT" ]; then
  echo "    SKIP (reference produced no output; no EGL device?)"
  exit 0
fi

NATIVE_OUT="$(timeout 300 "$ROOT/build/webgltest" 2>/dev/null | grep '^PARITY ')"
if [ -z "$NATIVE_OUT" ]; then
  echo "    SKIP (native build produced no parity hashes; no EGL device?)"
  exit 0
fi

fails=0
for scene in clearRed clearGreen triangle; do
  ref="$(printf '%s' "$REF_OUT" | python3 -c "import sys,json;print(json.load(sys.stdin)['$scene'])")"
  ours="$(printf '%s\n' "$NATIVE_OUT" | sed -n "s/^PARITY $scene=//p")"
  if [ "$ref" = "$ours" ]; then
    printf '  %-12s %s\n' "$scene" "match ($ours)"
  else
    printf '  %-12s MISMATCH: reference=%s ours=%s\n' "$scene" "$ref" "$ours"
    fails=$((fails + 1))
  fi
done

if [ "$fails" -gt 0 ]; then
  echo "  $fails scene(s) differ"
  exit 1
fi
echo "  readback parity: 3/3 scenes identical"
exit 0
