#!/usr/bin/env bash
# Fast type feedback, without waiting on a full compile.
#
#   ./scripts/typecheck.sh
#
# tsc against tsconfig.json, which is wired to scriptc's own ambient
# declarations so it sees the same surface the compiler does. Takes about a
# second against ~7 for a build, which makes it the right thing to run in an
# editor-save hook or before a commit.
#
# NOT authoritative. tsc knows types; it does not know scriptc's LOWERING
# fences, so it will happily accept a compound assignment through an indexed
# receiver (SC1090) or a stdlib method with no lowering (SC2020). Only
# `scriptc build` decides whether a program is really valid. This catches the
# ordinary type mistakes fast so the slow build is spent on the real ones.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

TSC="${TSC_BIN:-}"
if [ -z "$TSC" ]; then
  for c in "$ROOT/node_modules/.bin/tsc" "$ROOT/../scriptc/node_modules/.bin/tsc"; do
    [ -x "$c" ] && { TSC="$c"; break; }
  done
fi
[ -n "$TSC" ] || { echo "tsc not found; set TSC_BIN" >&2; exit 1; }

exec "$TSC" -p "$ROOT/tsconfig.json" --noEmit
