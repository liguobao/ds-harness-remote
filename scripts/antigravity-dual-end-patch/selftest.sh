#!/bin/bash
# =============================================================================
# antigravity-dual-end-patch / selftest.sh
# 在临时沙箱模拟“已安装插件目录”，跑 check / apply / regen-manifest 全流程。
# 绝不触碰真实安装目录（~/.dsh/...）。
# 覆盖：APPLIED 交叉验证、补丁 marker 防误判 NATIVE、NATIVE 双条件、CONFLICT 保守判定。
# =============================================================================
set -Eeuo pipefail

SELF_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PATCH_SH="$SELF_DIR/patch.sh"
TEMPLATE_MANIFEST="$SELF_DIR/manifest.tsv"

FAILURES=0
pass() { printf '  [PASS] %s\n' "$*"; }
fail() { printf '  [FAIL] %s\n' "$*" >&2; FAILURES=$((FAILURES + 1)); }
assert_eq() {
  local label="$1" got="$2" want="$3"
  if [[ "$got" == "$want" ]]; then pass "$label (=$want)"; else fail "$label: got[$got] want[$want]"; fi
}

[[ -f "$PATCH_SH" ]] || { echo "找不到 patch.sh: $PATCH_SH" >&2; exit 1; }
[[ -f "$TEMPLATE_MANIFEST" ]] || { echo "找不到 manifest 模板: $TEMPLATE_MANIFEST" >&2; exit 1; }

SANDBOX="$(mktemp -d "${TMPDIR:-/tmp}/adep-selftest.XXXXXX")"
cleanup() { rm -rf "$SANDBOX"; }
trap cleanup EXIT

WT="$SANDBOX/worktree"
PL="$SANDBOX/plugin"
CFGDIR="$SANDBOX/cfg"
STATE="$SANDBOX/state"
mkdir -p "$WT/packages/plugin/dist" "$PL/dist" "$CFGDIR" "$STATE"

# ---- 夹具：未打补丁的“安装目标” vs 已打补丁的“构建产物” ----
cat > "$PL/dist/index.js" <<'EOF'
// upstream 0.6.5 host entry
const ROOT = ".gemini/antigravity-cli"; // anchor #1
const SESS = ".gemini/antigravity-cli/sessions"; // anchor #2
const LOG  = ".gemini/antigravity-cli/log"; // anchor #3
const CACHE= ".gemini/antigravity-cli/cache"; // anchor #4
module.exports = { ROOT, SESS, LOG, CACHE };
EOF
cp -p "$PL/dist/index.js" "$SANDBOX/original.js"

cat > "$WT/packages/plugin/dist/index.js" <<'EOF'
// patched 0.6.6 host entry (dual-end)
const DSH_AGY_DUAL_END_PATCH_V1 = true; // 补丁独有 marker
const ROOT = ".gemini/antigravity-cli"; // anchor #1 (kept)
const SESS = ".gemini/antigravity-cli/sessions"; // anchor #2
const LOG  = ".gemini/antigravity-cli/log"; // anchor #3
const CACHE= ".gemini/antigravity-cli/cache"; // anchor #4
const DUAL = [".gemini/antigravity-cli", ".gemini/antigravity-cli-2"]; // 我们引入的符号
module.exports = { ROOT, SESS, LOG, CACHE, DUAL, DSH_AGY_DUAL_END_PATCH_V1 };
EOF

cat > "$CFGDIR/patch.conf" <<'EOF'
PATCH_FILES=(
  'packages/plugin/dist/index.js|dist/index.js|primary|selftest primary'
)
PATCH_MARKERS=( 'DSH_AGY_DUAL_END_PATCH_V1' )
NATIVE_MARKERS=( 'SELFTEST_NATIVE_APP_DATA_DIR_SUPPORT' )
ANCHORS=( '.gemini/antigravity-cli' )
EOF

cp -p "$TEMPLATE_MANIFEST" "$CFGDIR/manifest.tsv"

export WORKTREE_ROOT="$WT"
export PLUGIN_DIR="$PL"
export PATCH_CONF="$CFGDIR/patch.conf"
export PATCH_MANIFEST="$CFGDIR/manifest.tsv"
export PATCH_STATE_DIR="$STATE"
unset LOG_FILE || true

EXPECTED_SHA="$(shasum -a 256 "$WT/packages/plugin/dist/index.js" | awk '{print $1}')"

overall() {
  /bin/bash "$PATCH_SH" check --machine 2>/dev/null | awk -F'|' '$1=="OVERALL"{print $2}'
}
apply_rc() {
  local rc=0
  set +e
  /bin/bash "$PATCH_SH" apply >/dev/null 2>&1
  rc=$?
  set -e
  printf '%s' "$rc"
}
target_sha() { shasum -a 256 "$PL/dist/index.js" | awk '{print $1}'; }

echo "=== 自测沙箱: $SANDBOX ==="

echo "--- 用例 1: 模板清单 sha=PENDING -> MISSING，apply 拒绝（码 4） ---"
assert_eq "check(模板清单)" "$(overall)" "MISSING"
assert_eq "apply(模板清单)退出码" "$(apply_rc)" "4"

echo "--- 用例 2: regen-manifest 生成真实 sha ---"
/bin/bash "$PATCH_SH" regen-manifest >/dev/null 2>&1
GEN_SHA="$(awk -F'|' '/^packages\/plugin\/dist\/index.js\|/{print $3}' "$CFGDIR/manifest.tsv")"
assert_eq "regen 写入 sha" "$GEN_SHA" "$EXPECTED_SHA"

echo "--- 用例 3: 未打补丁目标 -> STALE ---"
assert_eq "check(上游目标)" "$(overall)" "STALE"

echo "--- 用例 4: apply -> APPLIED（补丁 marker 交叉验证）+ 备份存在 ---"
/bin/bash "$PATCH_SH" apply >/dev/null 2>&1
assert_eq "apply 后 check" "$(overall)" "APPLIED"
assert_eq "apply 后目标 sha" "$(target_sha)" "$EXPECTED_SHA"
LATEST_BK="$(ls -1dt "$STATE/backups"/* 2>/dev/null | head -1 || true)"
if [[ -f "$LATEST_BK/dist/index.js" ]] && cmp -s "$LATEST_BK/dist/index.js" "$SANDBOX/original.js"; then
  pass "备份内容与原始文件一致 ($LATEST_BK)"
else
  fail "备份缺失或内容不一致: $LATEST_BK"
fi

echo "--- 用例 5: 补丁 marker 在位但 checksum 漂移 -> STALE（绝不误判 NATIVE） ---"
cp -p "$WT/packages/plugin/dist/index.js" "$PL/dist/index.js"
printf '\n// drifted byte after build\n' >> "$PL/dist/index.js"
DRIFT_SHA="$(target_sha)"
assert_eq "check(补丁 marker + checksum 漂移)" "$(overall)" "STALE"
assert_eq "漂移文件未被 apply 改动前 sha 记录" "$DRIFT_SHA" "$(target_sha)"
assert_eq "apply(漂移)退出码" "$(apply_rc)" "0"
assert_eq "apply(漂移)后回到 APPLIED" "$(overall)" "APPLIED"

echo "--- 用例 6: 旧 anchor 仍在 + 上游原生特征 -> NATIVE，apply 拒绝（码 3）且不改动 ---"
cat > "$PL/dist/index.js" <<'EOF'
// upstream native support, old structure intact
const ROOT = ".gemini/antigravity-cli";
const NATIVE = "SELFTEST_NATIVE_APP_DATA_DIR_SUPPORT";
module.exports = { ROOT, NATIVE };
EOF
NATIVE_SHA="$(target_sha)"
assert_eq "check(anchor + 上游特征)" "$(overall)" "NATIVE"
assert_eq "apply(原生)退出码" "$(apply_rc)" "3"
assert_eq "apply(原生)未改动" "$(target_sha)" "$NATIVE_SHA"

echo "--- 用例 7: 旧 anchor 消失 + 上游特征 -> CONFLICT（保守），apply 拒绝 ---"
printf 'upstream rewrote everything: %s, no old anchors\n' 'SELFTEST_NATIVE_APP_DATA_DIR_SUPPORT' > "$PL/dist/index.js"
MIX_SHA="$(target_sha)"
assert_eq "check(anchor 消失 + 上游特征)" "$(overall)" "CONFLICT"
assert_eq "apply(边界)退出码" "$(apply_rc)" "3"
assert_eq "apply(边界)未改动" "$(target_sha)" "$MIX_SHA"

echo "--- 用例 8: anchor 缺失且无原生证据 -> CONFLICT，apply 拒绝且不改动 ---"
printf 'totally new structure, no anchor here\n' > "$PL/dist/index.js"
CONFLICT_SHA="$(target_sha)"
assert_eq "check(纯结构冲突)" "$(overall)" "CONFLICT"
assert_eq "apply(冲突)退出码" "$(apply_rc)" "3"
assert_eq "apply(冲突)未改动" "$(target_sha)" "$CONFLICT_SHA"

echo "--- 用例 9: 目标缺失 -> MISSING，apply 重建为 APPLIED ---"
rm -f "$PL/dist/index.js"
assert_eq "check(目标缺失)" "$(overall)" "MISSING"
/bin/bash "$PATCH_SH" apply >/dev/null 2>&1
assert_eq "apply(目标缺失)后 check" "$(overall)" "APPLIED"
assert_eq "apply(目标缺失)后 sha" "$(target_sha)" "$EXPECTED_SHA"

echo "--- 用例 10: 幂等再 apply 不产生新备份 ---"
BK_COUNT_BEFORE="$(find "$STATE/backups" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
/bin/bash "$PATCH_SH" apply >/dev/null 2>&1
BK_COUNT_AFTER="$(find "$STATE/backups" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l | tr -d ' ')"
assert_eq "幂等 apply 备份数不变" "$BK_COUNT_AFTER" "$BK_COUNT_BEFORE"

echo "=========================================="
if (( FAILURES == 0 )); then
  echo "自测全部通过（10 组用例）"
  exit 0
else
  echo "自测失败断言数: $FAILURES"
  exit 1
fi
