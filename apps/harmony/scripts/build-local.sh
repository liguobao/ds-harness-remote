#!/bin/sh
# Build with ignored local signing configuration, restoring the tracked profile on exit.
set -eu
cd "$(dirname "$0")/.."

if [ ! -f build-profile.local.json5 ]; then
  echo "缺少 build-profile.local.json5：请先在 DevEco Studio 配置本机签名。" >&2
  exit 1
fi

BUILD_COMMAND="${HVIGORW:-hvigorw}"
command -v "$BUILD_COMMAND" >/dev/null 2>&1 || {
  echo "找不到 hvigorw；请配置 DevEco SDK PATH 或 HVIGORW。" >&2
  exit 1
}

umask 077
BACKUP=$(mktemp "${TMPDIR:-/tmp}/dsh-harmony-profile.XXXXXX")
cp -p build-profile.json5 "$BACKUP"
restore() { cp -p "$BACKUP" build-profile.json5; rm -f "$BACKUP"; }
trap restore EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
chmod 600 build-profile.json5
cp build-profile.local.json5 build-profile.json5
"$BUILD_COMMAND" --no-daemon assembleHap -p product=default -p buildMode=debug "$@"
