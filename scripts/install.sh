#!/usr/bin/env bash
set -euo pipefail

# Usage: install.sh

NODE_VERSION="${NODE_VERSION:-22.14.0}"
DSH_VERSION="${DSH_VERSION:-latest}"
REMOTE_VERSION="${REMOTE_VERSION:-latest}"
DSH_PROFILE="${DSH_PROFILE:-web}"
NODE_HOME="${DSH_NODE_HOME:-${HOME}/.local/share/dsh-node/node-v${NODE_VERSION}}"
INSTALL_DIR="${DSH_INSTALL_DIR:-${HOME}/.local/share/dsh-remote}"
RUNTIME_DIR="$INSTALL_DIR/runtime"
CLI_BIN_DIR="$INSTALL_DIR/bin"
NPM_REGISTRY="${NPM_REGISTRY:-https://registry.npmmirror.com}"
SERVICE_NAME="${DSH_SERVICE_NAME:-dsh-remote}"
SERVICE_COMMAND="${DSH_SERVICE_COMMAND:-}"
# Remote control is enabled by the bundled Host profile. Keep the terminal
# opt-out available, but enable it for automated installations by default.
DSH_REMOTE_TERMINAL_ENABLED="${DSH_REMOTE_TERMINAL_ENABLED:-true}"
export DSH_REMOTE_TERMINAL_ENABLED
PATH_BLOCK_BEGIN='# >>> dsh-remote installer >>>'
PATH_BLOCK_END='# <<< dsh-remote installer <<<'

say() { printf '[dsh-install] %s\n' "$*"; }
die() { printf '[dsh-install] error: %s\n' "$*" >&2; exit 1; }

install_node() {
  command -v curl >/dev/null 2>&1 || die 'curl is required to install Node.js automatically.'
  local os arch archive url tmp extract_dir
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) die 'This script supports Linux and macOS. Use scripts/install.ps1 on Windows.' ;;
  esac
  case "$(uname -m)" in
    x86_64|amd64) arch=x64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "Unsupported CPU architecture: $(uname -m)" ;;
  esac
  archive="node-v${NODE_VERSION}-${os}-${arch}.tar.gz"
  url="https://npmmirror.com/mirrors/node/v${NODE_VERSION}/${archive}"
  tmp="$(mktemp -d)"
  say "Node.js not found; downloading ${NODE_VERSION} from npmmirror.com"
  curl --fail --location --retry 3 --output "$tmp/$archive" "$url"
  mkdir -p "$(dirname "$NODE_HOME")"
  tar -xzf "$tmp/$archive" -C "$(dirname "$NODE_HOME")"
  extract_dir="$(dirname "$NODE_HOME")/node-v${NODE_VERSION}-${os}-${arch}"
  if [[ "$extract_dir" != "$NODE_HOME" ]]; then
    rm -rf "$NODE_HOME"
    mv "$extract_dir" "$NODE_HOME"
  fi
  export PATH="$NODE_HOME/bin:$PATH"
  rm -rf "$tmp"
  say "Node.js installed at $NODE_HOME"
}

# Expose only the Remote launcher to later shells. The private DSH and pnpm
# must not shadow the user's existing commands.
persist_path() {
  local bin_dir="$1" rc
  local rcs=("${HOME}/.profile")
  case "${SHELL:-}" in
    */zsh) rcs+=("${HOME}/.zshrc") ;;
    */bash) rcs+=("${HOME}/.bashrc") ;;
  esac
  for rc in "${rcs[@]}"; do
    touch "$rc"
    if grep -qF "$PATH_BLOCK_BEGIN" "$rc"; then
      local tmp
      tmp="$(mktemp)"
      sed '/^# >>> dsh-remote installer >>>$/,/^# <<< dsh-remote installer <<<$/d' "$rc" >"$tmp"
      cat "$tmp" >"$rc"
      rm -f "$tmp"
    fi
    {
      printf '\n%s\n' "$PATH_BLOCK_BEGIN"
      printf 'export PATH=%q:"$PATH"\n' "$bin_dir"
      printf '%s\n' "$PATH_BLOCK_END"
    } >>"$rc"
    say "Added ${bin_dir} to PATH in $rc"
  done
}

if ! command -v node >/dev/null 2>&1; then install_node; fi
command -v npm >/dev/null 2>&1 || die 'npm was not found next to Node.js.'

[[ "$INSTALL_DIR" = /* && "$INSTALL_DIR" != / && "$INSTALL_DIR" != "$HOME" ]] || die 'DSH_INSTALL_DIR must be an absolute program directory, not / or HOME.'
NODE_BIN_DIR="$(dirname "$(command -v node)")"
mkdir -p "$RUNTIME_DIR" "$CLI_BIN_DIR"
# This marker also permits cleanup after a partially completed installation.
printf 'dsh-remote-private-runtime-v1\n' >"$RUNTIME_DIR/.dsh-remote-installer"
printf '%s\n' "$NODE_BIN_DIR" >"$INSTALL_DIR/node-bin"
if [[ -n "${DSH_HOME:-}" ]]; then
  printf '%s\n' "$DSH_HOME" >"$INSTALL_DIR/dsh-home"
else
  rm -f "$INSTALL_DIR/dsh-home"
fi
export PATH="$RUNTIME_DIR/bin:$NODE_BIN_DIR:$PATH"
say 'Installing private pnpm (required by the DSH plugin manager)'
# pnpm >= 11 matches the DSH profile settings and packageManager pin.
npm --registry "$NPM_REGISTRY" --prefix "$RUNTIME_DIR" install --global pnpm@11.21.0
pnpm --version
export npm_config_registry="$NPM_REGISTRY"

say "Installing @deepseek-ai/dsh (${DSH_VERSION})"
npm --registry "$NPM_REGISTRY" --prefix "$RUNTIME_DIR" install --global "@deepseek-ai/dsh@${DSH_VERSION}"
say "Installing ds-harness-remote CLI (${REMOTE_VERSION})"
npm --registry "$NPM_REGISTRY" --prefix "$RUNTIME_DIR" install --global "ds-harness-remote@${REMOTE_VERSION}"
REMOTE_PACKAGE_DIR="$RUNTIME_DIR/lib/node_modules/ds-harness-remote"
[[ -f "$REMOTE_PACKAGE_DIR/package.json" ]] || die "Private ds-harness-remote package was not found at $REMOTE_PACKAGE_DIR"

# The launcher records the Node location even when Node was downloaded here.
{
  printf '#!/usr/bin/env bash\nset -euo pipefail\n'
  printf 'export PATH=%q:"$PATH"\n' "$RUNTIME_DIR/bin:$NODE_BIN_DIR"
  if [[ -n "${DSH_HOME:-}" ]]; then printf 'export DSH_HOME=%q\n' "$DSH_HOME"; fi
  printf 'exec %q "$@"\n' "$RUNTIME_DIR/bin/ds-harness-remote"
} >"$CLI_BIN_DIR/ds-harness-remote"
chmod 700 "$CLI_BIN_DIR/ds-harness-remote"
persist_path "$CLI_BIN_DIR"

# -w is required: a DSH profile is itself a pnpm workspace, and pnpm < 11
# refuses to add a dependency to a workspace root without it
# (ERR_PNPM_ADDING_TO_ROOT), which aborts the install before the service step.
say "Adding ds-harness-remote@${REMOTE_VERSION} to the ${DSH_PROFILE} profile"
"$RUNTIME_DIR/bin/dsh" plugin --profile "$DSH_PROFILE" add -w "$REMOTE_PACKAGE_DIR"

say 'Plugins installed. Configuring the Host service.'

executable="${SERVICE_COMMAND:-}"
  if [[ -z "$executable" ]]; then
    executable="$RUNTIME_DIR/bin/dsh"
  fi
  [[ -n "$executable" ]] || die 'Cannot find dsh. Set DSH_SERVICE_COMMAND to its executable.'
  # A service has no interactive terminal and must use the installed profile.
  runner_dir="$INSTALL_DIR"
  mkdir -p "$runner_dir"
  runner="$runner_dir/start-host.sh"
  {
    printf '#!/usr/bin/env bash\nset -euo pipefail\n'
    printf 'export PATH=%q\n' "$PATH"
    printf 'export DSH_REMOTE_TERMINAL_ENABLED=%q\n' "$DSH_REMOTE_TERMINAL_ENABLED"
    if [[ -n "${DSH_HOME:-}" ]]; then printf 'export DSH_HOME=%q\n' "$DSH_HOME"; fi
    printf 'cd %q\n' "$HOME"
    printf 'exec %q --profile %q\n' "$executable" "$DSH_PROFILE"
  } > "$runner"
  chmod 700 "$runner"
  case "$(uname -s)" in
    Linux)
      command -v systemctl >/dev/null 2>&1 || die 'systemctl is required to install the system service.'
      if [[ "${EUID}" -eq 0 ]]; then
        sudo_prefix=""
      else
        command -v sudo >/dev/null 2>&1 || die 'sudo is required to install the system service. Re-run as root.'
        sudo_prefix="sudo"
      fi
      run_user="$(id -un)"
      unit_path="/etc/systemd/system/${SERVICE_NAME}.service"
      ${sudo_prefix} tee "$unit_path" >/dev/null <<EOF
[Unit]
Description=DSH Remote Host
After=network-online.target
Wants=network-online.target

[Service]
User=${run_user}
ExecStart=/bin/bash "${runner}"
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
      ${sudo_prefix} systemctl daemon-reload
      ${sudo_prefix} systemctl enable --now "${SERVICE_NAME}.service"
      say "Installed and started systemd system service ${SERVICE_NAME} (running as ${run_user})."
      ;;
    Darwin)
      plist_dir="${HOME}/Library/LaunchAgents"
      plist_path="$plist_dir/${SERVICE_NAME}.plist"
      mkdir -p "$plist_dir"
      escaped_command="${runner//&/&amp;}"
      escaped_command="${escaped_command//</&lt;}"
      escaped_command="${escaped_command//>/&gt;}"
      cat >"$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${SERVICE_NAME}</string>
<key>ProgramArguments</key><array><string>/bin/bash</string><string>${escaped_command}</string></array>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
</dict></plist>
EOF
      launchctl bootout "gui/$(id -u)" "$plist_path" >/dev/null 2>&1 || true
      launchctl bootstrap "gui/$(id -u)" "$plist_path"
      say "Installed and started launchd user agent ${SERVICE_NAME}."
      ;;
    *) die 'Service installation supports Linux systemd and macOS launchd.' ;;
esac

printf '\n'
say 'The ds-harness-remote CLI is ready to use. Examples:'
printf '  ds-harness-remote login zhihu     # sign in with a Zhihu QR code (default)\n'
printf '  ds-harness-remote login github    # sign in with GitHub\n'
printf '  ds-harness-remote status          # show login and Host status\n'
printf '  ds-harness-remote logout          # sign out this device\n'
say 'Inside dsh-TUI the equivalents are /remote login, /remote status, /remote logout.'

case "$(uname -s)" in
  Linux) say "After CLI login/logout, run: sudo systemctl restart ${SERVICE_NAME}.service" ;;
  Darwin) say "After CLI login/logout, run: launchctl kickstart -k gui/$(id -u)/${SERVICE_NAME}" ;;
esac
