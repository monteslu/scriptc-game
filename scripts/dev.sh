#!/usr/bin/env bash
# Rebuild and relaunch a game whenever its source changes.
#
#   ./scripts/dev.sh examples/dodge
#
# The edit-to-running-game loop. A game-code change is ~7s end to end (the
# shim is cached; see build-shim.sh), so this is watch-driven rather than
# a hot reload: scriptc is an ahead-of-time compiler and there is no live
# patching to be had. What it removes is the manual rebuild-relaunch cycle.
#
# The running game is killed before each rebuild, so the window closing IS
# the signal that a change was picked up.
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GAMEDIR="${1:?usage: dev.sh <gameDir> [-- args...]}"
GAMEDIR="${GAMEDIR%/}"
shift || true
[ "${1:-}" = "--" ] && shift || true

[ -d "$GAMEDIR" ] || { echo "not a game directory: $GAMEDIR" >&2; exit 1; }
BASE="$(basename "$GAMEDIR")"
BIN="$ROOT/build/$BASE"

# Watched: the game itself plus everything it can import. A shim edit is
# included because the rebuild handles it correctly and it is the other
# thing under active development.
WATCH_DIRS=("$GAMEDIR" "$ROOT/web" "$ROOT/engine" "$ROOT/host" "$ROOT/shim")

have_inotify=0
command -v inotifywait >/dev/null 2>&1 && have_inotify=1
if [ "$have_inotify" -eq 0 ]; then
  echo "note: inotifywait not found, falling back to 1s polling"
  echo "      (apt install inotify-tools for instant rebuilds)"
fi

GAME_PID=""
stop_game() {
  if [ -n "$GAME_PID" ] && kill -0 "$GAME_PID" 2>/dev/null; then
    kill "$GAME_PID" 2>/dev/null || true
    wait "$GAME_PID" 2>/dev/null || true
  fi
  GAME_PID=""
}
trap 'stop_game; echo; echo "dev: stopped"; exit 0' INT TERM

# A checksum of every watched source, for the polling fallback and to skip
# rebuilds when an editor touches a file without changing it.
fingerprint() {
  find "${WATCH_DIRS[@]}" \
       \( -name '*.ts' -o -name '*.cpp' -o -name '*.c' -o -name '*.h' -o -name '*.json' \) \
       -not -path '*/.sg-build/*' -print0 2>/dev/null \
    | sort -z | xargs -0 stat -c '%n %Y %s' 2>/dev/null | sha256sum
}

build_and_run() {
  stop_game
  echo
  echo "dev: building $BASE ..."
  local start
  start=$(date +%s)
  # Quiet on success, loud on failure: the useful signal is the error text,
  # not the codegen chatter that precedes it on every single build.
  local log="$ROOT/build/.dev-build.log"
  mkdir -p "$ROOT/build"
  if ! "$ROOT/scripts/build.sh" "$GAMEDIR" > "$log" 2>&1; then
    echo "dev: build FAILED"
    grep -vE '^(gen-entry:|gen-ffi:|built )' "$log" | tail -25
    return 1
  fi
  if [ ! -x "$BIN" ]; then
    echo "dev: build produced no binary at $BIN; still watching"
    return 1
  fi
  echo "dev: built in $(( $(date +%s) - start ))s, launching"
  "$BIN" "$@" &
  GAME_PID=$!
}

echo "dev: watching $BASE (ctrl-c to stop)"
build_and_run "$@"
last="$(fingerprint)"

while true; do
  if [ "$have_inotify" -eq 1 ]; then
    # -e close_write only: editors that write-then-rename would otherwise
    # fire several times per save.
    inotifywait -qq -r -e close_write -e move -e create \
      --exclude '(\.sg-build|/build/|\.git)' "${WATCH_DIRS[@]}" 2>/dev/null || sleep 1
  else
    sleep 1
  fi
  now="$(fingerprint)"
  if [ "$now" != "$last" ]; then
    last="$now"
    build_and_run "$@"
  fi
done
