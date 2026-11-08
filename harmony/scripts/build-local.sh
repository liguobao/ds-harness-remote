#!/bin/sh
# 本机构建（带签名）：把被 .gitignore 忽略的 build-profile.local.json5 临时顶上去，
# 构建结束后无论成败都还原成仓库里的「无签名」版本 —— 签名材料永远不进仓库。
#
#   用法：harmony/scripts/build-local.sh [额外 hvigor 参数]
#   产物：entry/build/default/outputs/default/entry-default-signed.hap
set -e
cd "$(dirname "$0")/.."

if [ ! -f build-profile.local.json5 ]; then
  echo "缺少 build-profile.local.json5（本机签名配置，不入库）" >&2
  echo "在 DevEco Studio 里打开本工程并点一次『自动签名』即可生成。" >&2
  exit 1
fi

BACKUP=".build-profile.tracked.json5"
cp build-profile.json5 "$BACKUP"
restore() { mv -f "$BACKUP" build-profile.json5; }
trap restore EXIT INT TERM

cp build-profile.local.json5 build-profile.json5
( umask 000; ~/.deveco/bin/devecocli build --build-mode debug "$@" )
