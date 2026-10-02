#!/usr/bin/env bash
set -euo pipefail

DSH_PROFILE="${DSH_PROFILE:-web}"
SERVICE_NAME="${DSH_SERVICE_NAME:-dsh-remote}"

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
rm -f "${HOME}/.local/share/dsh-remote/start-host.sh"
rmdir "${HOME}/.local/share/dsh-remote" >/dev/null 2>&1 || true

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

if command -v dsh >/dev/null 2>&1; then
  dsh plugin --profile "$DSH_PROFILE" remove ds-harness-remote >/dev/null 2>&1 || true
  dsh plugin --profile "$DSH_PROFILE" remove dsh-file-viewer >/dev/null 2>&1 || true
fi
if command -v npm >/dev/null 2>&1; then
  npm uninstall --global ds-harness-remote @deepseek-ai/dsh >/dev/null 2>&1 || true
fi
printf '[dsh-install] Removed service, CLI, and plugins from the %s profile. Node.js and credentials were kept.\n' "$DSH_PROFILE"
