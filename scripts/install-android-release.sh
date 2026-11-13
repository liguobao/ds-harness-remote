#!/usr/bin/env bash
# Build current checkout and update one connected Android device without clearing data.
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../apps/android" && pwd)"
if [[ "${1:-}" == --help ]]; then
  echo 'Usage: scripts/install-android-release.sh [adb-serial]'
  echo 'Requires Node, pnpm, JDK and Android SDK. Uses ANDROID_SERIAL if set.'
  exit 0
fi
[[ $# -le 1 ]] || { echo 'Expected at most one adb serial.' >&2; exit 1; }
if [[ -z "${ANDROID_HOME:-}" && -z "${ANDROID_SDK_ROOT:-}" ]]; then
  for sdk in "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
    if [[ -d "$sdk" ]]; then export ANDROID_HOME="$sdk"; break; fi
  done
fi
export ANDROID_HOME="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}"
[[ -n "$ANDROID_HOME" ]] && export PATH="$ANDROID_HOME/platform-tools:$PATH"
for command in node pnpm java adb; do
  command -v "$command" >/dev/null || { echo "Missing prerequisite: $command" >&2; exit 1; }
done
serial="${1:-${ANDROID_SERIAL:-}}"
if [[ -z "$serial" ]]; then
  devices=()
  while IFS= read -r device; do devices+=("$device"); done < <(adb devices | awk 'NR > 1 && $2 == "device" {print $1}')
  [[ ${#devices[@]} -eq 1 ]] || { echo 'Connect exactly one authorized device, or specify its adb serial.' >&2; adb devices -l; exit 1; }
  serial="${devices[0]}"
fi
[[ "$(adb -s "$serial" get-state)" == device ]]
abi="$(adb -s "$serial" shell getprop ro.product.cpu.abi | tr -d '\r')"
case "$abi" in arm64-v8a|armeabi-v7a|x86|x86_64) ;; *) echo "Unsupported device ABI: $abi" >&2; exit 1 ;; esac
cd "$APP_DIR"
export NODE_ENV=production
pnpm run prepare:workspace
pnpm run check
# Regenerate in place so app.json version, plugins and native dependencies are current.
pnpm exec expo prebuild --platform android --no-install
(
  cd android
  ./gradlew :app:assembleRelease "-PreactNativeArchitectures=$abi" --console=plain
)
apk="$APP_DIR/android/app/build/outputs/apk/release/app-release.apk"
[[ -s "$apk" ]]
cp "$apk" "$APP_DIR/dsh-remote-latest.apk"
package="$(node -p "JSON.parse(require('fs').readFileSync('app.json', 'utf8')).expo.android.package")"
version="$(node -p "JSON.parse(require('fs').readFileSync('app.json', 'utf8')).expo.version")"
code="$(node -p "JSON.parse(require('fs').readFileSync('app.json', 'utf8')).expo.android.versionCode")"
adb -s "$serial" install -r "$apk"
installed="$(adb -s "$serial" shell dumpsys package "$package")"
[[ "$installed" == *"versionCode=$code "* && "$installed" == *"versionName=$version"* ]] || {
  echo "Installed version does not match app.json ($version / $code)." >&2; exit 1;
}
echo "$installed" | awk '/versionCode=|versionName=/ {if (++count <= 2) print}'
echo "Installed $apk on $serial ($abi)"
