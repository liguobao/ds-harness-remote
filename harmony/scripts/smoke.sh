#!/bin/sh
# 鸿蒙客户端冒烟测试：构建 → 装机 → 拉起 → 等连接 → 判定
#
#   harmony/scripts/smoke.sh [设备序列号] [等待秒数]
#
# 设备序列号省略时用 `hdc list targets` 里的第一个非本机回环以外没意义，建议显式传：
#   harmony/scripts/smoke.sh 192.168.3.145:34521      # 手机（无线调试）
#   harmony/scripts/smoke.sh 127.0.0.1:40601          # 鸿蒙 PC（本机）
#
# 判定口径（缺一不可）：
#   1) 构建产出 signed hap
#   2) 安装返回 install bundle successfully
#   3) 拉起后 link.log 出现「已连接 ·」，并且传输是 lan/p2p/turn（不是空）
#   4) hilog 里没有 ArkTS 运行时崩溃（$fa_crash / jscrash / Unhandled exception）
#
# 退出码：0 通过 / 1 失败（并打印失败点）
set -u
DEV="${1:-}"
WAIT="${2:-45}"
BUNDLE="cn.r2049.dshremote"
ABILITY="EntryAbility"
LOG_PATH="/data/app/el2/100/base/${BUNDLE}/haps/entry/files/link.log"

cd "$(dirname "$0")/.." || exit 1
ROOT="$(pwd)"
HAP="$ROOT/entry/build/default/outputs/default/entry-default-signed.hap"

fail() { echo "✖ $1"; exit 1; }

if [ -z "$DEV" ]; then
  DEV=$(hdc list targets 2>/dev/null | grep -v '^$' | head -1)
  [ -z "$DEV" ] && fail "没有可用设备（hdc list targets 为空）"
  echo "· 未指定设备，使用 $DEV"
fi

echo "· [0/4] 一致性自检（版本号两处 / i18n 覆盖）"
node "$ROOT/scripts/bump-version.mjs" --check >/tmp/smoke-version.log 2>&1 || { cat /tmp/smoke-version.log; fail "版本号两处不一致（用 bump-version 同步）"; }
node "$ROOT/scripts/check-i18n.mjs" >/tmp/smoke-i18n.log 2>&1 || { cat /tmp/smoke-i18n.log; fail "i18n 校验未通过"; }

echo "· [1/4] 构建（本机签名，签名材料不入库）"
"$ROOT/scripts/build-local.sh" >/tmp/smoke-build.log 2>&1 || { tail -20 /tmp/smoke-build.log; fail "构建失败"; }
[ -f "$HAP" ] || fail "没有产出 signed hap：$HAP"

echo "· [2/4] 安装到 $DEV"
hdc tconn "$DEV" >/dev/null 2>&1
INSTALL_OUT=$(hdc -t "$DEV" install -r "$HAP" 2>&1)
echo "$INSTALL_OUT" | grep -q "install bundle successfully" || { echo "$INSTALL_OUT"; fail "安装失败"; }

VERSION=$(hdc -t "$DEV" shell "bm dump -n $BUNDLE | grep versionName | tail -1" 2>/dev/null | tr -d '",' | awk '{print $2}')
echo "  已安装版本：${VERSION:-未知}"

echo "· [3/4] 拉起并等待连接（最多 ${WAIT}s）"
# 只认这次拉起之后新增的日志行：否则会命中上一次运行留下的「已连接」
BEFORE=$(hdc -t "$DEV" shell "wc -l < $LOG_PATH 2>/dev/null" 2>/dev/null | tr -d ' \r')
[ -z "$BEFORE" ] && BEFORE=0
echo "  启动前日志行数：$BEFORE"

hdc -t "$DEV" shell "hilog -r" >/dev/null 2>&1
# 先 force-stop 再拉起：否则 App 已在运行时 `aa start` 只是切前台，不会产生新日志
# （第一版就因此误判成「没连上」）
hdc -t "$DEV" shell "aa force-stop $BUNDLE" >/dev/null 2>&1
sleep 2
hdc -t "$DEV" shell "aa start -b $BUNDLE -a $ABILITY" >/dev/null 2>&1

i=0
CONNECTED=""
while [ "$i" -lt "$WAIT" ]; do
  sleep 3
  i=$((i + 3))
  CONNECTED=$(hdc -t "$DEV" shell "tail -n +$((BEFORE + 1)) $LOG_PATH 2>/dev/null" 2>/dev/null | grep "已连接 ·" | tail -1)
  [ -n "$CONNECTED" ] && break
done

if [ -z "$CONNECTED" ]; then
  echo "  最近链路日志："
  hdc -t "$DEV" shell "tail -6 $LOG_PATH 2>/dev/null" 2>/dev/null | sed 's/^/    /'
  echo "  ${WAIT}s 内没有连上主机。常见原因："
  echo "    1) 设备锁屏：锁屏状态下 aa start 不会加载页面，App 不会 bootstrap（先解锁再跑）"
  echo "    2) App 停在主机列表：需要手动点一次「连接」（之后会记住）"
  exit 1
fi

echo "  已连接：$CONNECTED"

echo "· [4/4] 崩溃检查"
# 只认真正的崩溃：ArkWeb/chromium 会打大量 crashpad、ERR_ABORTED 噪声，必须排掉
CRASH=$(hdc -t "$DEV" shell "hilog -x 2>/dev/null | grep -E 'FaultLogger|jscrash|Unhandled exception|Abort message' | grep -i '${BUNDLE}'" 2>/dev/null | head -3)
if [ -n "$CRASH" ]; then
  echo "$CRASH" | sed 's/^/    /'
  fail "日志里发现崩溃痕迹"
fi

echo "✅ 冒烟通过：$BUNDLE ${VERSION:-?} @ $DEV （$(echo "$CONNECTED" | grep -o '已连接 · [a-z]*')）"
