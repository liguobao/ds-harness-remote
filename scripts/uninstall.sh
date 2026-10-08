#!/usr/bin/env bash
set -euo pipefail

# Remove only Remote from an existing Harness profile.
DSH_COMMAND="${DSH_COMMAND:-}"
DSH_PROFILE="${DSH_PROFILE:-}"
PLUGIN_URL='https://github.com/liguobao/ds-harness-remote'

say() { printf '[dsh-plugin] %s\n' "$*"; }
desktop_help() {
  say 'DeepSeek Harness Desktop: open Extensions / Plugin management.'
  say "Plugin address: $PLUGIN_URL"
  say 'Install or remove Remote there, then restart Desktop.'
  say "To use this script, enable Desktop's official dsh command or set DSH_COMMAND to its launcher."
}

# Use the installed CLI, including Desktop's official immutable-runtime launcher.
# Do not create command links or change the invoking shell's PATH.
desktop_command=''
if [[ "$(uname -s)" = Darwin ]]; then
  for candidate in "$HOME/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh" "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"; do
    if [[ -x "$candidate" ]]; then desktop_command="$candidate"; break; fi
  done
fi
if [[ -n "$DSH_COMMAND" ]]; then
  DSH_COMMAND="$(command -v "$DSH_COMMAND")" || { say 'DSH_COMMAND was not found.' >&2; exit 1; }
elif [[ -n "$desktop_command" ]]; then
  DSH_COMMAND="$desktop_command"
elif command -v dsh >/dev/null 2>&1; then
  DSH_COMMAND="$(command -v dsh)"
else
  desktop_help
  say 'No existing dsh command found. No plugin was changed.' >&2
  exit 1
fi
if [[ -z "$DSH_PROFILE" ]]; then
  case "$DSH_COMMAND" in
    */runtime/cli/bin/dsh) DSH_PROFILE=desktop ;;
    *)
      # Desktop may publish its launcher as a hard link in /usr/local/bin.
      if [[ -n "$desktop_command" ]] && cmp -s "$DSH_COMMAND" "$desktop_command"; then
        DSH_PROFILE=desktop
      else
        DSH_PROFILE=web
      fi ;;
  esac
fi
[[ "$DSH_PROFILE" =~ ^[A-Za-z0-9_-]+$ ]] || { say 'Invalid DSH_PROFILE.' >&2; exit 1; }
if [[ "$DSH_PROFILE" = desktop ]]; then
  say 'Using the Desktop profile. Its official Desktop CLI must manage this reserved profile.'
fi

say "Removing ds-harness-remote from profile ${DSH_PROFILE} using ${DSH_COMMAND}"
"$DSH_COMMAND" plugin --profile "$DSH_PROFILE" remove -w ds-harness-remote
say 'Remote plugin removed. Restart the selected Harness instance.'
