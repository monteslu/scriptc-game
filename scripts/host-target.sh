#!/usr/bin/env bash
# Print the SG_TARGET matching the machine we are running on.
#
# Sourced by build.sh and test.sh so `build.sh <game>` and `test.sh` link
# the right architecture's archives on every dev machine without an
# explicit target. CI keeps setting SG_TARGET from its matrix, which wins.
host_target() {
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64)          echo macos-aarch64 ;;
    Darwin-x86_64)         echo macos-x86_64 ;;
    Linux-aarch64)         echo linux-aarch64 ;;
    MINGW*|MSYS*|CYGWIN*)  echo windows-x86_64 ;;
    *)                     echo linux-x86_64 ;;
  esac
}
