#!/usr/bin/env bash
# Rebake the .sgm fixtures, then run the raycaster + loader suite.
#
# Rebaking rather than committing only the .sgm files means a change to the
# format or the baker is caught here: a stale fixture would otherwise keep
# passing against a loader that no longer matches.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

node codegen/bake-mesh.js test/mesh-fixtures/tetra.obj test/mesh-fixtures/tetra.sgm >/dev/null
node codegen/bake-mesh.js test/mesh-fixtures/tri.glb test/mesh-fixtures/tri.sgm >/dev/null

SDL_VIDEODRIVER=dummy SDL_AUDIODRIVER=dummy exec ./build/raytest
