#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"
SERVICE_NAME="${DSH_SERVICE_NAME:-dsh-remote}"
INSTALL_DIR="${DSH_INSTALL_DIR:-${HOME}/.local/share/dsh-remote}"
RUNTIME_DIR="$INSTALL_DIR/runtime"
[[ "$INSTALL_DIR" = /* && "$INSTALL_DIR" != / && "$INSTALL_DIR" != "$HOME" ]] || { printf '[dsh-install] Invalid DSH_INSTALL_DIR.\n' >&2; exit 1; }

case "$(uname -s)" in
  Linux)
    if [[ "${EUID}" -eq 0 ]]; then sudo_prefix=""; else sudo_prefix="sudo"; fi
    ${sudo_prefix} systemctl disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    ${sudo_prefix} rm -f "/etc/systemd/system/${SERVICE_NAME}.service"
    ${sudo_prefix} systemctl daemon-reload >/dev/null 2>&1 || true
    systemctl --user disable --now "${SERVICE_NAME}.service" >/dev/null 2>&1 || true
    rm -f "${HOME}/.config/systemd/user/${SERVICE_NAME}.service"
    systemctl --user daemon-reload >/dev/null 2>&1 || true
    ;;
  Darwin)
    launchctl bootout "gui/$(id -u)" "${HOME}/Library/LaunchAgents/${SERVICE_NAME}.plist" >/dev/null 2>&1 || true
    rm -f "${HOME}/Library/LaunchAgents/${SERVICE_NAME}.plist"
    ;;
esac

# The service entry point install.sh generated; it embeds this machine's paths.
rm -f "$INSTALL_DIR/start-host.sh"

# Drop the PATH block install.sh added; the marker pair is the only thing this
# script is allowed to remove from a user's shell files.
for rc in "${HOME}/.profile" "${HOME}/.bashrc" "${HOME}/.zshrc"; do
  [[ -f "$rc" ]] || continue
  grep -qF '# >>> dsh-remote installer >>>' "$rc" || continue
  tmp="$(mktemp)"
  sed '/^# >>> dsh-remote installer >>>$/,/^# <<< dsh-remote installer <<<$/d' "$rc" >"$tmp"
  cat "$tmp" >"$rc"
  rm -f "$tmp"
  printf '[dsh-install] Removed the PATH entry from %s\n' "$rc"
done

# Never uninstall packages from the user's global npm environment, including
# legacy installations. Only this installer's marked private runtime is owned.
if [[ -f "$RUNTIME_DIR/.dsh-remote-installer" ]] && [[ "$(cat "$RUNTIME_DIR/.dsh-remote-installer")" = dsh-remote-private-runtime-v1 ]]; then
  if [[ -f "$INSTALL_DIR/node-bin" ]]; then
    NODE_BIN_DIR="$(cat "$INSTALL_DIR/node-bin")"
    export PATH="$RUNTIME_DIR/bin:$NODE_BIN_DIR:$PATH"
  fi
  if [[ -f "$INSTALL_DIR/dsh-home" ]]; then
    export DSH_HOME="$(cat "$INSTALL_DIR/dsh-home")"
  fi
  if [[ -x "$RUNTIME_DIR/bin/dsh" ]]; then
    "$RUNTIME_DIR/bin/dsh" plugin --profile "$DSH_PROFILE" remove ds-harness-remote >/dev/null 2>&1 || true
  fi
  rm -rf "$RUNTIME_DIR"
  rm -f "$INSTALL_DIR/bin/ds-harness-remote" "$INSTALL_DIR/node-bin" "$INSTALL_DIR/dsh-home"
  rmdir "$INSTALL_DIR/bin" >/dev/null 2>&1 || true
else
  printf '[dsh-install] No managed private runtime found; existing global packages and profile plugins were kept.\n'
fi
rmdir "$INSTALL_DIR" >/dev/null 2>&1 || true
printf '[dsh-install] Removed service and managed private runtime. Node.js, profiles, credentials and existing global packages were kept.\n'
