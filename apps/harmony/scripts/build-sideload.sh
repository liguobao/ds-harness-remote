#!/bin/sh
# Build a device-authorized debug HAP for hdc installation.
set -eu
cd "$(dirname "$0")/.."

if [ ! -f build-profile.local.json5 ]; then
  echo "缺少 build-profile.local.json5：请在 DevEco Studio 选择 Debug 签名，并把设备 UDID 加入 profile。" >&2
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

cp build-profile.local.json5 build-profile.json5
"$BUILD_COMMAND" --no-daemon assembleHap -p product=default -p buildMode=debug "$@"
echo "已生成可供 hdc 侧载的 Debug HAP。"
