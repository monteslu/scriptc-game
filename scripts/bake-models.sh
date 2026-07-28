#!/usr/bin/env bash
# Bake every shared .glb into the .sgm files the examples load.
#
# Sources live in examples/shared/models/ and the baked output is
# gitignored: a committed .sgm would keep passing against a loader that no
# longer matched the baker, which is exactly the class of drift the
# fixtures script guards against.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

DEST="${1:-examples/orbits/public}"
mkdir -p "$DEST"

SRC="${2:-examples/shared/models}"

for glb in "$SRC"/*.glb; do
  [ -f "$glb" ] || continue
  name="$(basename "$glb" .glb)"
  node codegen/bake-mesh.js "$glb" "$DEST/$name.sgm" | tail -1
done
