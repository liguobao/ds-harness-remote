#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
HERMES_COMPILER="${PODS_ROOT:?PODS_ROOT is required}/hermes-engine/destroot/bin/hermesc"
if [[ ! -x "$HERMES_COMPILER" ]]; then
  echo "error: Hermes compiler not found at $HERMES_COMPILER; run pod install" >&2
  exit 1
fi

exec "$HERMES_COMPILER" "-include-globals=$SCRIPT_DIR/hermes-runtime-globals.js" "$@"
