#!/usr/bin/env bash
# Build an independent entry; restore generated Gradle configuration on exit.
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$repo"
serial="${1:?Usage: build-device.sh adb-serial}"
export EXPO_PUBLIC_DSH_BENCH_URL="$(node -p 'JSON.parse(require("fs").readFileSync("/tmp/dsh-transport-bench-config.json","utf8")).url')"
export NODE_ENV=production
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [[ -z "${JAVA_HOME:-}" && -d '/Applications/Android Studio.app/Contents/jbr/Contents/Home' ]]; then
 export JAVA_HOME='/Applications/Android Studio.app/Contents/jbr/Contents/Home'
fi
export PATH="${JAVA_HOME:+$JAVA_HOME/bin:}$ANDROID_HOME/platform-tools:$PATH"
gradle="$repo/apps/android/android/app/build.gradle"
backup="$(mktemp)"
cp "$gradle" "$backup"
native="$repo/apps/android/modules/remote-transport/android/src/main/java/io/github/liguobao/dshremote/transport/RemoteWebRtcBinaryModule.kt"
native_backup="$(mktemp)"
cp "$native" "$native_backup"
trap 'cp "$backup" "$gradle"; cp "$native_backup" "$native"; rm -f "$backup" "$native_backup"' EXIT
python3 - "$native" "$repo/scripts/transport-bench/native-websocket-bench.kt.txt" <<'PYTHON'
import sys
p=sys.argv[1];s=open(p).read().replace('payload.size <= 16384','payload.size <= 65535')
s=s.replace('import android.util.Base64','import android.util.Base64\nimport okio.ByteString.Companion.toByteString')
s=s.replace('    Name("RemoteWebRtcBinary")','    Name("RemoteWebRtcBinary")\n'+open(sys.argv[2]).read())
open(p,'w').write(s)
PYTHON
python3 - "$gradle" <<'PY'
import sys
p=sys.argv[1]; s=open(p).read(); lines=s.splitlines(True)
found=False
for i,line in enumerate(lines):
 if line.strip().startswith('entryFile ='):
  lines[i]='    entryFile = file("../../bench/index.tsx")\n';found=True;break
if not found: raise SystemExit('Generated Gradle entryFile not found')
open(p,'w').writelines(lines)
PY
(cd apps/android/android && ./gradlew :app:createBundleReleaseJsAndAssets --rerun :app:assembleRelease -PreactNativeArchitectures=arm64-v8a --console=plain)
cp apps/android/android/app/build/outputs/apk/release/app-release.apk /tmp/dsh-independent-bench.apk
adb -s "$serial" reverse tcp:18792 tcp:18792
adb -s "$serial" install -r /tmp/dsh-independent-bench.apk
adb -s "$serial" shell am force-stop io.github.liguobao.dshremote
adb -s "$serial" shell am start -n io.github.liguobao.dshremote/.MainActivity
