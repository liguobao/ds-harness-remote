#!/bin/bash
# =============================================================================
# antigravity-dual-end-patch / patch.sh
#
# 已安装 ds-harness-remote 插件的“防更新自动补丁”工具。
#   - 源码/构建产物来自本 worktree（packages/plugin/dist/...）
#   - 补丁只写到已安装插件目录，绝不改动 worktree 源码
#   - host entry = dist/index.js（esbuild bundle，首要目标）
#
# 兼容 macOS 自带 Bash 3.2（不使用 mapfile / 关联数组 / ${var^^}）。
# =============================================================================
set -Eeuo pipefail

# ---------------------------------------------------------------- 基础路径 --
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
SCRIPT_NAME="$(basename -- "${BASH_SOURCE[0]}")"

# 脚本位于 <worktree>/scripts/antigravity-dual-end-patch/
DEFAULT_WORKTREE_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd -P)"
WORKTREE_ROOT="${WORKTREE_ROOT:-$DEFAULT_WORKTREE_ROOT}"

# 已安装插件目录（可用环境变量覆盖，便于自测）
PLUGIN_DIR="${PLUGIN_DIR:-$HOME/.dsh/profiles/desktop/node_modules/ds-harness-remote}"

# 状态目录：备份 / 日志 / launchd 产物
STATE_DIR="${PATCH_STATE_DIR:-$HOME/.dsh/antigravity-dual-end-patch}"
BACKUP_ROOT="${PATCH_BACKUP_ROOT:-$STATE_DIR/backups}"

# 配置与清单（可用环境变量覆盖，便于自测）
CONF_PATH="${PATCH_CONF:-$SCRIPT_DIR/patch.conf}"
MANIFEST_PATH="${PATCH_MANIFEST:-$SCRIPT_DIR/manifest.tsv}"

# launchd
LAUNCHD_LABEL="com.aplier.dsh-antigravity-dual-end-patch"
LAUNCHD_PLIST="${LAUNCHD_PLIST:-$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist}"
LAUNCHD_OUT_LOG="${LAUNCHD_OUT_LOG:-$STATE_DIR/launchd.out.log}"
LAUNCHD_ERR_LOG="${LAUNCHD_ERR_LOG:-$STATE_DIR/launchd.err.log}"

# 行为开关
DRY_RUN="${DRY_RUN:-false}"
MACHINE=false
VERBOSE="${VERBOSE:-false}"
QUIET=false

# 由 patch.conf 填充
declare -a NATIVE_MARKERS=()
declare -a PATCH_MARKERS=()
declare -a ANCHORS=()
declare -a PATCH_FILES=()

# 清单解析结果（平行数组）
declare -a M_SOURCE=()
declare -a M_TARGET=()
declare -a M_SHA=()
declare -a M_ROLE=()
declare -a M_PURPOSE=()

# check 结果
declare -a CHECK_STATES=()
OVERALL_STATE=""

# 临时目录（EXIT 清理）
TMPDIR_WORK=""

# 退出码: 0=OK 1=常规错误 2=用法错误 3=NATIVE/CONFLICT 阻止 4=清单/源未就绪
EXIT_OK=0
EXIT_ERR=1
EXIT_USAGE=2
EXIT_BLOCKED=3
EXIT_NOT_READY=4

# ------------------------------------------------------------------ 日志 --
_ts() { date '+%Y-%m-%d %H:%M:%S'; }

_log() {
  local lvl="$1"; shift
  local line
  line="[$(_ts)] [$lvl] $*"
  printf '%s\n' "$line" >&2
  if [[ -n "${LOG_FILE:-}" ]]; then
    printf '%s\n' "$line" >> "$LOG_FILE" 2>/dev/null || true
  fi
}
log_info()  { _log INFO "$@"; }
log_warn()  { _log WARN "$@"; }
log_error() { _log ERROR "$@"; }
log_debug() { if [[ "$VERBOSE" == "true" ]]; then _log DEBUG "$@"; fi; }
die()       { log_error "$@"; exit "$EXIT_ERR"; }

cleanup() {
  if [[ -n "$TMPDIR_WORK" && -d "$TMPDIR_WORK" ]]; then
    rm -rf "$TMPDIR_WORK"
  fi
}
trap cleanup EXIT

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少必需命令: $1"
}

make_tmpdir() {
  TMPDIR_WORK="$(mktemp -d "${TMPDIR:-/tmp}/adep.XXXXXX")" || die "无法创建临时目录"
}

# ------------------------------------------------------------ 小工具函数 --
trim() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

sha256_file() {
  local f="$1" out=""
  if command -v shasum >/dev/null 2>&1; then
    out="$(shasum -a 256 "$f" 2>/dev/null | awk '{print $1}')"
  elif command -v sha256sum >/dev/null 2>&1; then
    out="$(sha256sum "$f" 2>/dev/null | awk '{print $1}')"
  elif command -v openssl >/dev/null 2>&1; then
    out="$(openssl dgst -sha256 "$f" 2>/dev/null | awk '{print $NF}')"
  else
    return 1
  fi
  [[ -n "$out" ]] || return 1
  printf '%s' "$out"
}

file_mode() {
  local f="$1" m=""
  m="$(stat -f '%Lp' "$f" 2>/dev/null || true)"
  if [[ -z "$m" ]]; then
    m="$(stat -c '%a' "$f" 2>/dev/null || true)"
  fi
  [[ -n "$m" ]] || m="644"
  printf '%s' "$m"
}

# 同目录临时文件 + mv，保证目标要么完整替换要么原样不动
atomic_copy() {
  local src="$1" dst="$2" d tmp mode
  d="$(dirname "$dst")"
  mkdir -p "$d" || return 1
  tmp="$(mktemp "$d/.adep.XXXXXX")" || return 1
  if ! cp -p "$src" "$tmp"; then rm -f "$tmp"; return 1; fi
  mode="$(file_mode "$src")"
  chmod "$mode" "$tmp" 2>/dev/null || true
  if ! mv -f "$tmp" "$dst"; then rm -f "$tmp"; return 1; fi
  log_debug "atomic_copy: $src -> $dst"
}

# 备份单文件到 BACKUP_ROOT/<stamp>/<相对路径>
backup_target() {
  local rel="$1"
  local stamp="$2"
  local dst="$BACKUP_ROOT/$stamp/$rel"
  [[ -f "$PLUGIN_DIR/$rel" ]] || return 0
  mkdir -p "$(dirname "$dst")" || return 1
  cp -p "$PLUGIN_DIR/$rel" "$dst" || return 1
  log_debug "backup: $PLUGIN_DIR/$rel -> $dst"
}

# -------------------------------------------------------------- 配置加载 --
load_conf() {
  [[ -f "$CONF_PATH" ]] || die "配置不存在: $CONF_PATH"
  NATIVE_MARKERS=(); PATCH_MARKERS=(); ANCHORS=(); PATCH_FILES=()
  # shellcheck disable=SC1090
  source "$CONF_PATH"
  (( ${#PATCH_FILES[@]} > 0 )) || die "配置中 PATCH_FILES 为空: $CONF_PATH"
  if (( ${#PATCH_MARKERS[@]} == 0 )); then
    log_warn "配置中 PATCH_MARKERS 为空，APPLIED 交叉验证与自打补丁识别将不可用。"
  fi
}

# -------------------------------------------------------------- 清单解析 --
read_manifest() {
  M_SOURCE=(); M_TARGET=(); M_SHA=(); M_ROLE=(); M_PURPOSE=()
  [[ -f "$MANIFEST_PATH" ]] || die "清单不存在: ${MANIFEST_PATH}（请先运行 regen-manifest）"
  local line s t sha role purpose n=0
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "$line" ]] && continue
    [[ "$line" == \#* ]] && continue
    IFS='|' read -r s t sha role purpose <<< "$line"
    s="$(trim "$s")"; t="$(trim "$t")"; sha="$(trim "$sha")"
    role="$(trim "$role")"; purpose="$(trim "$purpose")"
    [[ -n "$s" && -n "$t" ]] || continue
    M_SOURCE[$n]="$s"
    M_TARGET[$n]="$t"
    M_SHA[$n]="$sha"
    M_ROLE[$n]="${role:-consistency}"
    M_PURPOSE[$n]="${purpose:-}"
    n=$(( n + 1 ))
  done < "$MANIFEST_PATH"
  (( n > 0 )) || die "清单为空或无有效行: ${MANIFEST_PATH}（请先运行 regen-manifest）"
}

# ---------------------------------------------------------- 状态判定核心 --
native_markers_present() {
  local f="$1" m
  for m in "${NATIVE_MARKERS[@]}"; do
    [[ -n "$m" ]] || continue
    if grep -Fq -- "$m" "$f"; then return 0; fi
  done
  return 1
}

# 我们补丁独有 marker（上游绝不会有）：用于 APPLIED 交叉验证、并防止自打补丁被误判 NATIVE
patch_marker_present() {
  local f="$1" m
  for m in "${PATCH_MARKERS[@]}"; do
    [[ -n "$m" ]] || continue
    if grep -Fq -- "$m" "$f"; then return 0; fi
  done
  return 1
}

anchors_present() {
  local f="$1" a
  for a in "${ANCHORS[@]}"; do
    [[ -n "$a" ]] || continue
    if ! grep -Fq -- "$a" "$f"; then return 1; fi
  done
  return 0
}

# 设定全局 STATE / STATE_REASON
# 判定顺序（防误判 NATIVE）：
#   1) manifest 未生成 / 源缺失 / 目标缺失 -> MISSING
#   2) checksum 命中 -> APPLIED（补丁 marker 在位则交叉验证通过，否则告警）
#   3) checksum 未命中但“补丁 marker 在位”-> STALE（我们自己的补丁，绝不判 NATIVE）
#   4) 旧 anchor 仍在 + 命中上游原生特征 -> NATIVE
#   5) 旧 anchor 消失 -> CONFLICT（anchor 消失但有上游特征也保守判 CONFLICT，待人工确认）
#   6) 其余 -> STALE（普通升级覆盖）
determine_state() {
  local srel="$1" trel="$2" expected="$3"
  local src_abs="$WORKTREE_ROOT/$srel"
  local tgt_abs="$PLUGIN_DIR/$trel"
  STATE=""; STATE_REASON=""
  if [[ "$expected" == "PENDING" || -z "$expected" ]]; then
    STATE="MISSING"; STATE_REASON="manifest 未生成（sha=PENDING）"; return 0
  fi
  if [[ ! -f "$src_abs" ]]; then
    STATE="MISSING"; STATE_REASON="源构建产物不存在: $src_abs"; return 0
  fi
  if [[ ! -f "$tgt_abs" ]]; then
    STATE="MISSING"; STATE_REASON="安装目标不存在: $tgt_abs"; return 0
  fi
  local actual
  if ! actual="$(sha256_file "$tgt_abs")"; then
    STATE="MISSING"; STATE_REASON="目标 sha256 计算失败: $tgt_abs"; return 0
  fi

  local has_patch_marker=false has_native_marker=false has_anchor=true
  if patch_marker_present "$tgt_abs"; then has_patch_marker=true; fi
  if native_markers_present "$tgt_abs"; then has_native_marker=true; fi
  if ! anchors_present "$tgt_abs"; then has_anchor=false; fi

  # 2) checksum 命中 = APPLIED；补丁 marker 仅作交叉验证（缺失则告警，不翻转状态）
  if [[ "$actual" == "$expected" ]]; then
    if [[ "$has_patch_marker" == "true" ]]; then
      STATE="APPLIED"; STATE_REASON="checksum 匹配 + 补丁 marker 交叉验证通过"
    else
      STATE="APPLIED"; STATE_REASON="checksum 匹配，但未找到补丁 marker（确认清单源产物是否含 marker）"
      log_warn "${trel}: checksum 命中但缺少补丁 marker，manifest 可能与补丁产物不同步。"
    fi
    return 0
  fi

  # 3) checksum 未命中：若含我们的补丁 marker，说明是补丁在位但清单可能过期 —— 绝不判 NATIVE
  if [[ "$has_patch_marker" == "true" ]]; then
    STATE="STALE"; STATE_REASON="补丁 marker 在位但 checksum 不符（manifest 可能过期，建议 regen-manifest）"
    return 0
  fi

  # 4) NATIVE 需“旧 anchor 仍在 + 出现上游原生特征”双条件
  if [[ "$has_anchor" == "true" && "$has_native_marker" == "true" ]]; then
    STATE="NATIVE"; STATE_REASON="旧 anchor 仍在且出现上游原生特征，禁止覆盖"
    return 0
  fi

  # 5) 旧 anchor 消失：一律 CONFLICT（即便出现上游特征，证据不足仍需人工确认）
  if [[ "$has_anchor" == "false" ]]; then
    STATE="CONFLICT"
    if [[ "$has_native_marker" == "true" ]]; then
      STATE_REASON="旧 anchor 消失（虽见上游特征，证据不足）→ 保守判 CONFLICT，请人工确认"
    else
      STATE_REASON="旧结构 anchor 消失，补丁基础已变化"
    fi
    return 0
  fi

  # 6) 普通升级覆盖
  STATE="STALE"; STATE_REASON="checksum 不匹配（疑似升级后被上游覆盖）"
  return 0
}

state_rank() {
  case "$1" in
    APPLIED)  printf '1' ;;
    STALE)    printf '2' ;;
    MISSING)  printf '3' ;;
    NATIVE)   printf '4' ;;
    CONFLICT) printf '5' ;;
    *)        printf '0' ;;
  esac
}

compute_overall() {
  local s v best="APPLIED" bestv=1
  for s in "${CHECK_STATES[@]}"; do
    v="$(state_rank "$s")"
    if (( v > bestv )); then bestv="$v"; best="$s"; fi
  done
  OVERALL_STATE="$best"
}

# 运行 check：填充 CHECK_STATES / OVERALL_STATE，按 QUIET 决定是否打印
run_check() {
  read_manifest
  CHECK_STATES=()
  local i state reason
  for i in "${!M_SOURCE[@]}"; do
    determine_state "${M_SOURCE[$i]}" "${M_TARGET[$i]}" "${M_SHA[$i]}"
    state="$STATE"; reason="$STATE_REASON"
    CHECK_STATES[$i]="$state"
    if [[ "$QUIET" != "true" ]]; then
      if [[ "$MACHINE" == "true" ]]; then
        printf '%s|%s\n' "${M_TARGET[$i]}" "$state"
      else
        printf '%-8s %-24s %s\n' "$state" "${M_TARGET[$i]}" "$reason"
      fi
    fi
  done
  compute_overall
  if [[ "$QUIET" != "true" ]]; then
    if [[ "$MACHINE" == "true" ]]; then
      printf 'OVERALL|%s\n' "$OVERALL_STATE"
    else
      printf '总体状态: %s\n' "$OVERALL_STATE"
    fi
  fi
}

# ---------------------------------------------------------------- 命令 --
usage() {
  cat <<EOF
用法: $SCRIPT_NAME [选项] <命令>

命令:
  check               逐文件判定 APPLIED / STALE / NATIVE / CONFLICT / MISSING
  apply               幂等应用补丁（NATIVE/CONFLICT 时拒绝；先备份再原子替换）
  status              人类可读摘要（路径 + 逐文件状态 + 备份 + launchd）
  regen-manifest      依据 patch.conf 与当前构建产物重新生成 manifest.tsv（含 sha256）
  install-launchd     生成并加载 LaunchAgent，WatchPaths 触发 check + apply
  uninstall-launchd   卸载并移除 LaunchAgent plist
  daemon              install-launchd 使用：先 check 再 apply
  selftest            在临时沙箱运行 check/apply/regen 自测（不碰真实安装目录）

选项:
  --dry-run           只打印将执行的动作，不写任何文件
  --machine           check 使用机器可读输出: <target>|STATE，最后一行 OVERALL|STATE
  -v, --verbose       调试日志
  -h, --help          本帮助

环境变量覆盖:
  WORKTREE_ROOT       构建产物所在 worktree 根（默认脚本上两级）
  PLUGIN_DIR          已安装插件目录（默认 ~/.dsh/profiles/desktop/node_modules/ds-harness-remote）
  PATCH_CONF          patch.conf 路径
  PATCH_MANIFEST      manifest.tsv 路径
  PATCH_STATE_DIR     备份/日志状态根（默认 ~/.dsh/antigravity-dual-end-patch）
  PATCH_BACKUP_ROOT   备份根（默认 <STATE_DIR>/backups）
  PATCH_LOG_FILE      额外把日志追加到该文件
  LAUNCHD_PLIST       plist 路径
  DRY_RUN=true        等价于 --dry-run

退出码: 0=成功/APPLIED 1=常规错误 2=用法错误 3=NATIVE或CONFLICT阻止 4=清单或源未就绪
EOF
}

COMMAND=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --machine) MACHINE=true; shift ;;
    -v|--verbose) VERBOSE=true; shift ;;
    -h|--help) usage; exit "$EXIT_OK" ;;
    check|apply|status|regen-manifest|install-launchd|uninstall-launchd|daemon|selftest)
      COMMAND="$1"; shift ;;
    --) shift; break ;;
    *)
      log_error "未知参数: $1"
      usage >&2
      exit "$EXIT_USAGE"
      ;;
  esac
done

[[ -n "$COMMAND" ]] || { usage >&2; exit "$EXIT_USAGE"; }
need_cmd grep
need_cmd mktemp
need_cmd shasum || need_cmd sha256sum || need_cmd openssl

# ------------------------------------------------------------ apply 实现 --
run_apply() {
  load_conf
  read_manifest

  # 前置：清单必须全部就绪
  local i sha
  for i in "${!M_SOURCE[@]}"; do
    sha="${M_SHA[$i]}"
    if [[ "$sha" == "PENDING" || -z "$sha" ]]; then
      log_error "清单尚未生成（${M_TARGET[$i]} 的 sha=${sha}）。请先构建补丁产物后运行: ${SCRIPT_NAME} regen-manifest"
      exit "$EXIT_NOT_READY"
    fi
  done

  # check（打印逐文件状态）
  run_check

  # 阻止条件
  local s
  for s in "${CHECK_STATES[@]}"; do
    if [[ "$s" == "CONFLICT" || "$s" == "NATIVE" ]]; then
      log_error "check 结果为 ${s}：为避免破坏安装目录，apply 已拒绝执行。"
      log_error "请人工核对 anchor/marker 与补丁适配情况后再处理（详见 docs/antigravity-dual-end-patch.md）。"
      exit "$EXIT_BLOCKED"
    fi
  done

  # 计算需要打补丁的文件；源缺失则拒绝
  declare -a TO_PATCH=()
  for i in "${!M_SOURCE[@]}"; do
    [[ "${CHECK_STATES[$i]}" == "APPLIED" ]] && continue
    if [[ ! -f "$WORKTREE_ROOT/${M_SOURCE[$i]}" ]]; then
      log_error "源构建产物不存在，无法 apply: $WORKTREE_ROOT/${M_SOURCE[$i]}"
      exit "$EXIT_NOT_READY"
    fi
    TO_PATCH+=("$i")
  done

  if (( ${#TO_PATCH[@]} == 0 )); then
    log_info "补丁已全部应用（APPLIED），无需改动。"
    exit "$EXIT_OK"
  fi

  local stamp
  stamp="$(date '+%Y%m%d-%H%M%S')"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] 将备份 ${#TO_PATCH[@]} 个原文件到: $BACKUP_ROOT/$stamp/"
    for i in "${TO_PATCH[@]}"; do
      log_info "[DRY RUN] 将复制 $WORKTREE_ROOT/${M_SOURCE[$i]} -> $PLUGIN_DIR/${M_TARGET[$i]}"
    done
    log_info "[DRY RUN] 不会实际写入。"
    exit "$EXIT_OK"
  fi

  # 备份原文件
  mkdir -p "$BACKUP_ROOT/$stamp" || die "无法创建备份目录: $BACKUP_ROOT/$stamp"
  for i in "${TO_PATCH[@]}"; do
    backup_target "${M_TARGET[$i]}" "$stamp" || die "备份失败: ${M_TARGET[$i]}"
  done
  log_info "原文件已备份到: $BACKUP_ROOT/$stamp/"

  # 原子替换
  for i in "${TO_PATCH[@]}"; do
    atomic_copy "$WORKTREE_ROOT/${M_SOURCE[$i]}" "$PLUGIN_DIR/${M_TARGET[$i]}" \
      || die "复制失败: ${M_TARGET[$i]}（备份在 $BACKUP_ROOT/$stamp/）"
  done

  # 应用后必须再次 check == APPLIED
  QUIET=true
  run_check
  QUIET=false
  if [[ "$OVERALL_STATE" != "APPLIED" ]]; then
    log_error "应用后校验失败（OVERALL=${OVERALL_STATE}），执行回滚..."
    for i in "${TO_PATCH[@]}"; do
      local rel="${M_TARGET[$i]}"
      local bk="$BACKUP_ROOT/$stamp/${M_TARGET[$i]}"
      if [[ -f "$bk" ]]; then
        atomic_copy "$bk" "$PLUGIN_DIR/$rel" || true
      else
        rm -f "$PLUGIN_DIR/$rel" || true
      fi
    done
    log_error "已回滚。备份目录: $BACKUP_ROOT/$stamp/"
    exit "$EXIT_ERR"
  fi

  log_info "补丁应用成功，校验 APPLIED。备份目录: $BACKUP_ROOT/$stamp/"
}

# ------------------------------------------------------ regen-manifest --
run_regen_manifest() {
  load_conf
  need_cmd date

  local d
  d="$(dirname "$MANIFEST_PATH")"
  mkdir -p "$d" || die "无法创建清单目录: $d"

  local stamp
  stamp="$(date '+%Y%m%d-%H%M%S')"

  if [[ -f "$MANIFEST_PATH" && "$DRY_RUN" != "true" ]]; then
    mkdir -p "$BACKUP_ROOT/$stamp" || true
    cp -p "$MANIFEST_PATH" "$BACKUP_ROOT/$stamp/manifest.tsv" || true
    log_info "旧清单已备份到: $BACKUP_ROOT/$stamp/manifest.tsv"
  fi

  declare -a lines=()
  local spec srel trel role purpose src_abs sha skipped=0
  for spec in "${PATCH_FILES[@]}"; do
    [[ -n "$spec" ]] || continue
    [[ "$spec" == \#* ]] && continue
    IFS='|' read -r srel trel role purpose <<< "$spec"
    srel="$(trim "$srel")"; trel="$(trim "$trel")"
    role="$(trim "$role")"; purpose="$(trim "$purpose")"
    [[ -n "$srel" && -n "$trel" ]] || continue
    src_abs="$WORKTREE_ROOT/$srel"
    if [[ ! -f "$src_abs" ]]; then
      if [[ "$role" == "primary" ]]; then
        die "primary 源产物不存在: ${src_abs}（请先构建 packages/plugin/dist）"
      fi
      log_warn "一致性源产物不存在，跳过: $src_abs"
      skipped=$(( skipped + 1 ))
      continue
    fi
    sha="$(sha256_file "$src_abs")" || die "sha256 计算失败: $src_abs"
    lines+=("$srel|$trel|$sha|${role:-consistency}|${purpose:-}")
    log_info "记录 $srel -> $trel  sha=$sha"
  done

  if (( ${#lines[@]} == 0 )); then
    die "没有任何可写入清单的文件（primary 缺失或全部跳过）"
  fi

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] 将写入清单: $MANIFEST_PATH （${#lines[@]} 行，跳过 $skipped 行）"
    local l
    for l in "${lines[@]}"; do printf '%s\n' "$l"; done
    exit "$EXIT_OK"
  fi

  local tmp
  tmp="$(mktemp "$d/.manifest.XXXXXX")" || die "无法创建清单临时文件"
  {
    printf '# antigravity-dual-end-patch manifest（由 regen-manifest 生成，勿手工改 sha）\n'
    printf '# 列: source_rel|target_rel|sha256|role|purpose\n'
    printf '# source_rel 相对 WORKTREE_ROOT；target_rel 相对 PLUGIN_DIR\n'
    printf '# 生成时间: %s  WORKTREE_ROOT=%s\n' "$stamp" "$WORKTREE_ROOT"
    local l
    for l in "${lines[@]}"; do printf '%s\n' "$l"; done
  } > "$tmp"
  mv -f "$tmp" "$MANIFEST_PATH" || die "原子写入清单失败: $MANIFEST_PATH"

  log_info "清单已生成: $MANIFEST_PATH （${#lines[@]} 行，跳过 $skipped 行）"
  log_info "primary 目标为 dist/index.js（host entry）；marker/anchor 检测在同一文件上进行。"
}

# -------------------------------------------------------------- status --
run_status() {
  load_conf
  printf 'WORKTREE_ROOT : %s\n' "$WORKTREE_ROOT"
  printf 'PLUGIN_DIR    : %s\n' "$PLUGIN_DIR"
  printf 'CONF_PATH     : %s\n' "$CONF_PATH"
  printf 'MANIFEST_PATH : %s\n' "$MANIFEST_PATH"
  printf 'STATE_DIR     : %s\n' "$STATE_DIR"
  printf 'NATIVE markers: %d  ANCHORS: %d  PATCH_FILES: %d\n' \
    "${#NATIVE_MARKERS[@]}" "${#ANCHORS[@]}" "${#PATCH_FILES[@]}"
  printf '\n--- 逐文件状态 ---\n'
  run_check

  printf '\n--- 最近备份 ---\n'
  if [[ -d "$BACKUP_ROOT" ]]; then
    local latest=""
    latest="$(ls -1dt "$BACKUP_ROOT"/* 2>/dev/null | head -1 || true)"
    if [[ -n "$latest" && -d "$latest" ]]; then
      printf '%s\n' "$latest"
    else
      printf '(无备份)\n'
    fi
  else
    printf '(无备份目录)\n'
  fi

  printf '\n--- launchd ---\n'
  printf 'plist : %s\n' "$LAUNCHD_PLIST"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if launchctl print "gui/$(id -u)/$LAUNCHD_LABEL" >/dev/null 2>&1; then
      printf '状态  : 已加载\n'
    else
      printf '状态  : 未加载\n'
    fi
  else
    printf '状态  : 非 macOS，未检查\n'
  fi
  printf 'out   : %s\n' "$LAUNCHD_OUT_LOG"
  printf 'err   : %s\n' "$LAUNCHD_ERR_LOG"
}

# ------------------------------------------------------- launchd 管理 --
plist_content() {
  local watch_block
  watch_block="
    <key>WatchPaths</key>
    <array>
      <string>$PLUGIN_DIR/package.json</string>
      <string>$PLUGIN_DIR/dist</string>
    </array>"
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$SCRIPT_DIR/$SCRIPT_NAME</string>
    <string>daemon</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  $watch_block
  <key>StandardOutPath</key>
  <string>$LAUNCHD_OUT_LOG</string>
  <key>StandardErrorPath</key>
  <string>$LAUNCHD_ERR_LOG</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
EOF
}

run_install_launchd() {
  [[ "$(uname -s)" == "Darwin" ]] || die "install-launchd 仅适用于 macOS（当前 $(uname -s)）"
  [[ -d "$PLUGIN_DIR" ]] || die "已安装插件目录不存在: $PLUGIN_DIR"
  [[ -x "$SCRIPT_DIR/$SCRIPT_NAME" || -f "$SCRIPT_DIR/$SCRIPT_NAME" ]] || die "找不到 patch.sh"
  mkdir -p "$STATE_DIR" || die "无法创建状态目录: $STATE_DIR"
  mkdir -p "$(dirname "$LAUNCHD_PLIST")" || die "无法创建 LaunchAgents 目录"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] 将写入 plist: $LAUNCHD_PLIST"
    plist_content
    log_info "[DRY RUN] 将 bootout/bootstrap/kickstart label=$LAUNCHD_LABEL"
    exit "$EXIT_OK"
  fi

  local tmp
  tmp="$(mktemp "$(dirname "$LAUNCHD_PLIST")/.adep.XXXXXX")" || die "无法创建 plist 临时文件"
  plist_content > "$tmp"
  if [[ -f "$LAUNCHD_PLIST" ]]; then
    cp -p "$LAUNCHD_PLIST" "$STATE_DIR/${LAUNCHD_LABEL}.plist.bak" || true
  fi
  mv -f "$tmp" "$LAUNCHD_PLIST" || die "原子写入 plist 失败: $LAUNCHD_PLIST"
  log_info "plist 已写入: $LAUNCHD_PLIST"

  local uid
  uid="$(id -u)"

  # 先卸载可能存在的旧任务（兼容新旧 launchctl）
  launchctl bootout "gui/$uid" "$LAUNCHD_PLIST" 2>/dev/null || true
  launchctl unload -w "$LAUNCHD_PLIST" 2>/dev/null || true

  if launchctl bootstrap "gui/$uid" "$LAUNCHD_PLIST" 2>/dev/null; then
    launchctl enable "gui/$uid/$LAUNCHD_LABEL" 2>/dev/null || true
    launchctl kickstart -k "gui/$uid/$LAUNCHD_LABEL" 2>/dev/null || true
  else
    launchctl load -w "$LAUNCHD_PLIST" || die "launchctl 加载失败: $LAUNCHD_PLIST"
  fi

  if launchctl print "gui/$uid/$LAUNCHD_LABEL" >/dev/null 2>&1; then
    log_info "LaunchAgent 已加载: $LAUNCHD_LABEL"
  else
    log_warn "plist 已写入但 launchctl 未能确认加载，请用 launchctl print 手动核对。"
  fi
  log_info "日志: $LAUNCHD_OUT_LOG / $LAUNCHD_ERR_LOG"
}

run_uninstall_launchd() {
  [[ "$(uname -s)" == "Darwin" ]] || die "uninstall-launchd 仅适用于 macOS（当前 $(uname -s)）"
  local uid
  uid="$(id -u)"

  if [[ "$DRY_RUN" == "true" ]]; then
    log_info "[DRY RUN] 将 bootout/unload label=${LAUNCHD_LABEL}，并备份移除 ${LAUNCHD_PLIST}"
    exit "$EXIT_OK"
  fi

  launchctl bootout "gui/$uid" "$LAUNCHD_PLIST" 2>/dev/null || true
  launchctl unload -w "$LAUNCHD_PLIST" 2>/dev/null || true

  if [[ -f "$LAUNCHD_PLIST" ]]; then
    mkdir -p "$STATE_DIR" || true
    mv -f "$LAUNCHD_PLIST" "$STATE_DIR/${LAUNCHD_LABEL}.plist.removed.$(date '+%Y%m%d-%H%M%S')" \
      || die "移除 plist 失败: $LAUNCHD_PLIST"
    log_info "plist 已移出 LaunchAgents 并留档于 $STATE_DIR/"
  else
    log_info "plist 不存在，无需移除: $LAUNCHD_PLIST"
  fi
  log_info "LaunchAgent 已卸载: $LAUNCHD_LABEL"
}

run_daemon() {
  log_info "launchd 触发: check + apply"
  run_check || true
  run_apply
}

# --------------------------------------------------------------- 分派 --
case "$COMMAND" in
  check)              load_conf; run_check ;;
  apply)              run_apply ;;
  status)             run_status ;;
  regen-manifest)     run_regen_manifest ;;
  install-launchd)    run_install_launchd ;;
  uninstall-launchd)  run_uninstall_launchd ;;
  daemon)             load_conf; run_daemon ;;
  selftest)           /bin/bash "$SCRIPT_DIR/selftest.sh" ;;
  *)                  usage >&2; exit "$EXIT_USAGE" ;;
esac
