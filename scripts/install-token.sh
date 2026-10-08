#!/usr/bin/env bash
set -euo pipefail

# Install and register a Host using a one-time server-issued registration token.
# Usage: scripts/install-token.sh TOKEN
token="${1:-}"
[[ -n "$token" ]] || { printf 'Usage: %s TOKEN\n' "$0" >&2; exit 2; }
case "$token" in *[![:alnum:]-]*) printf 'The server token contains unsupported characters.\n' >&2; exit 2;; esac

export DSH_REMOTE_TERMINAL_ENABLED=true
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
"$script_dir/install.sh"
"${DSH_INSTALL_DIR:-${HOME}/.local/share/dsh-remote}/bin/ds-harness-remote" register "$token"
printf '[dsh-install] Host registered and remote terminal enabled.\n'
