#!/bin/zsh

# Xcode Cloud bootstrap for the DSH Remote pnpm monorepo (Expo SDK 57 / RN 0.86).
# Adapted from the private repository's proven script for this public layout:
# the workspace root is the repository root, the iOS package is
# @dsh-remote/ios, and the shared source and renderer scripts live in
# packages/app-core.
#
# Xcode Cloud only executes scripts that live next to the workspace, so this
# file is committed at apps/ios/ios/ci_scripts/. Everything the archive needs
# that is not committed to git is (re)built here:
#   1. Node 22 + pnpm 9 (pinned by the root package.json "packageManager")
#   2. pnpm workspace dependencies (root pnpm-lock.yaml, applies patches/)
#   3. shared workspace dist/ (client-core/crypto/protocol/webrtc) and the
#      bundled terminal/PDF/Mermaid/Intelligent UI renderers in
#      packages/app-core/src/generated/
#   4. apps/ios/ios/.xcode.env.local pointing NODE_BINARY at the node installed
#      above — the "Bundle React Native code and images" phase sources it, and
#      the xcodebuild shell PATH does not include Homebrew
#   5. CocoaPods (Pods/ stays out of git)
#   6. Pre-built ExpoModulesJSI xcframework so the nested xcodebuild in the
#      build phase cannot swallow compiler errors
set -euo pipefail

fail() { echo "ci_post_clone: error: $*" >&2; exit 1; }

cd "${CI_PRIMARY_REPOSITORY_PATH:-$(git rev-parse --show-toplevel)}"

# --- 1. Node 22 + pnpm ------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v\([0-9]*\).*/\1/'; }
if [[ "$(node_major)" == "22" ]]; then
  echo "ci_post_clone: using preinstalled $(command -v node) ($(node -v))"
else
  brew list node@22 >/dev/null 2>&1 || brew install node@22
  export PATH="$(brew --prefix node@22)/bin:$PATH"
fi
[[ "$(node_major)" == "22" ]] || fail "expected Node 22, got $(node -v 2>&1)"

npm install --global pnpm@9.15.4
echo "ci_post_clone: node $(node -v), pnpm $(pnpm -v)"

# --- 2/3. workspace deps + generated sources for Metro ----------------------
pnpm install --frozen-lockfile
# pnpm applies the version-pinned iOS fixes from patches/ here.

# The Intelligent UI card bundles an audited offline renderer at build time
# (packages/app-core/src/generated/, gitignored). The source lives in a separate
# repo, so pin the same commit + file content hash the GitHub workflows verify;
# build-intelligent-ui.mjs falls back to a disabled stub unless
# DSH_REQUIRE_INTELLIGENT_UI is set.
INTELLIGENT_UI_COMMIT=f3735efffd823f8c34817f4e8554743ac3276225
INTELLIGENT_UI_HASH=ebac4a4c2199383458d4e1fa2121be0e6043c5c0
INTELLIGENT_UI_DIR="$PWD/.deps/deepseek-harness-intelligent-ui"
if [[ ! -d "$INTELLIGENT_UI_DIR/.git" ]]; then
  mkdir -p "$PWD/.deps"
  git clone --quiet https://github.com/dreamfarer-space/deepseek-harness-intelligent-ui.git "$INTELLIGENT_UI_DIR" \
    || fail "could not clone the Intelligent UI renderer source"
fi
git -C "$INTELLIGENT_UI_DIR" fetch --quiet origin "$INTELLIGENT_UI_COMMIT" >/dev/null 2>&1 || true
git -C "$INTELLIGENT_UI_DIR" checkout --quiet --detach "$INTELLIGENT_UI_COMMIT" \
  || fail "could not check out Intelligent UI renderer $INTELLIGENT_UI_COMMIT"
[[ "$(git -C "$INTELLIGENT_UI_DIR" hash-object renderer/renderer.js)" == "$INTELLIGENT_UI_HASH" ]] \
  || fail "unexpected Intelligent UI renderer content"
export DSH_INTELLIGENT_UI_RENDERER_BUNDLE="$INTELLIGENT_UI_DIR/renderer/renderer.js"
export DSH_REQUIRE_INTELLIGENT_UI=true

# Build the packages apps/ios depends on, then the renderers, then verify the
# data planes with the app root passed explicitly (app.json lives per app).
pnpm --filter '@dsh-remote/ios^...' -r build
pnpm --filter @dsh-remote/app-core run build:renderers
node packages/app-core/scripts/verify-workspace-data-planes.mjs apps/ios
node packages/app-core/scripts/verify-intelligent-ui-renderer.mjs

# --- 4. NODE_BINARY + optional build-time env for the bundle phase -----------
{
  echo "export NODE_BINARY=$(command -v node)"
  if [[ -n "${EXPO_PUBLIC_DSH_REMOTE_SERVER:-}" ]]; then
    echo "export EXPO_PUBLIC_DSH_REMOTE_SERVER=${EXPO_PUBLIC_DSH_REMOTE_SERVER}"
  fi
} > apps/ios/ios/.xcode.env.local

# --- 5. CocoaPods ------------------------------------------------------------
cd apps/ios/ios
pod install

# --- 6. Pre-build ExpoModulesJSI xcframework ---------------------------------
# The "[CP-User] Build ExpoModulesJSI xcframework" build phase compiles this
# SPM package with a nested `xcodebuild -quiet`, so when it fails on CI the
# real compiler error is swallowed and Xcode only shows the useless
# "emitted errors but did not return a nonzero exit code" pair. Building the
# slices here instead means: on success the build phase hits the per-slice
# hash cache and becomes a no-op; on failure the real error shows in full.
# Keep the configuration in sync with the build phase (Release, iphoneos +
# iphonesimulator). expo-modules-jsi is a transitive dep hoisted to the root
# node_modules, so resolve it through expo's package like the GitHub workflow
# does.
JSI_PACKAGE="$(node -p "require('path').dirname(require.resolve('expo-modules-jsi/package.json', { paths: [require('path').dirname(require.resolve('expo/package.json'))] }))")"
PODS_ROOT="$PWD/Pods" "${JSI_PACKAGE}/apple/scripts/build-xcframework.sh"

echo "ci_post_clone: done"
