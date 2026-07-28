#!/usr/bin/env bash
# InstancedMesh acceptance gate: does instancing draw the SAME pixels as
# drawing the same transforms one mesh at a time?
#
# spinfield renders an identical field two ways -- one InstancedMesh with a
# per-instance matrix buffer, or N separate Meshes -- from the same per-cube
# math. If the instancing path is right, the two are pixel-identical.
#
# This catches the errors instancing actually makes: a transposed or
# mis-strided matrix attribute, a wrong divisor, a normal matrix that
# forgets the per-instance rotation, or an off-by-one in the uploaded
# prefix. All of those still render a plausible field, so only a comparison
# finds them.
#
# The comparison is only meaningful if it can FAIL, so a control run
# perturbs one cube in the instanced path and must be detected.
#
# Requires ImageMagick-free pure-Python compare (numpy + Pillow), and skips
# loudly if those are missing rather than silently passing.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/examples/spinfield/main.ts"
OUT="$(mktemp -d)"
trap 'rm -rf "$OUT"; restore' EXIT

BACKUP="$OUT/main.ts.orig"
cp "$SRC" "$BACKUP"
restore() { [ -f "$BACKUP" ] && cp "$BACKUP" "$SRC"; }

if ! python3 -c "import numpy, PIL" 2>/dev/null; then
  echo "    SKIP (needs python3 numpy + Pillow)"
  exit 0
fi

# The sweep changes count over time; pin a single configuration so both
# runs render the same scene, and disable it for the comparison.
pin() {  # pin <instanced true|false> <extra-sed-expr>
  cp "$BACKUP" "$SRC"
  sed -i -e "s/const SWEEP_FRAMES = [0-9]*;/const SWEEP_FRAMES = 0;/" \
         -e "s/const START_INSTANCED = \(true\|false\);/const START_INSTANCED = $1;/" \
         -e "s/const START_COUNT = [0-9]*;/const START_COUNT = 2000;/" "$SRC"
  if [ -n "${2:-}" ]; then sed -i -e "$2" "$SRC"; fi
  "$ROOT/scripts/build.sh" examples/spinfield >/dev/null 2>&1 || return 1
}

shoot() {  # shoot <path>
  SG_NO_VSYNC=1 SG_MAX_FRAMES=300 SG_SHOT="$1" SG_SHOT_FRAME=200 \
    timeout 300 "$ROOT/build/spinfield" >/dev/null 2>&1
  [ -s "$1" ]
}

compare() {  # compare <a> <b> -> prints differing pixel count
  python3 - "$1" "$2" <<'PY'
import sys
import numpy as np
from PIL import Image, ImageChops
a = Image.open(sys.argv[1]).convert("RGB")
b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size:
    print("-1"); raise SystemExit
d = np.asarray(ImageChops.difference(a, b)).astype(int)
print(int((d.sum(2) > 12).sum()))
PY
}

pin true  "" || { echo "    FAIL (instanced build failed)"; exit 1; }
shoot "$OUT/inst.png" || { echo "    FAIL (instanced run produced no shot)"; exit 1; }

pin false "" || { echo "    FAIL (per-mesh build failed)"; exit 1; }
shoot "$OUT/mesh.png" || { echo "    FAIL (per-mesh run produced no shot)"; exit 1; }

DIFF="$(compare "$OUT/inst.png" "$OUT/mesh.png")"

# CONTROL: one cube deliberately wrong in the instanced path only. If this
# does NOT differ, the comparison is blind and the result above is worthless.
pin true "s/scl.set(c.scale, c.scale, c.scale);/scl.set(c.scale * (i === 0 ? 3.0 : 1.0), c.scale, c.scale);/" \
  || { echo "    FAIL (control build failed)"; exit 1; }
shoot "$OUT/ctl.png" || { echo "    FAIL (control run produced no shot)"; exit 1; }
CTL="$(compare "$OUT/ctl.png" "$OUT/mesh.png")"

restore
"$ROOT/scripts/build.sh" examples/spinfield >/dev/null 2>&1

echo "  instanced vs per-mesh: $DIFF differing pixels"
echo "  control (1 cube wrong): $CTL differing pixels"

if [ "$CTL" -le 0 ]; then
  echo "    FAIL: the control did not differ -- the comparison cannot detect a"
  echo "          wrong transform, so the parity result means nothing."
  exit 1
fi
if [ "$DIFF" -ne 0 ]; then
  echo "    FAIL: instancing does not match per-mesh rendering."
  exit 1
fi
echo "    PASS"
