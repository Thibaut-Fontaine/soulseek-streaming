#!/bin/bash
# Claude Code cloud sessions: everything needed to run the tests, the linter
# and to build the Android APK (cd android && ./gradlew assembleRelease).
# Idempotent: steps already done are skipped, so later sessions start fast.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

PROJECT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
SDK=/opt/android-sdk
# Must match android/build.gradle (compileSdkVersion, buildToolsVersion,
# ndkVersion) and the CMake version React Native's native build asks for.
PACKAGES=("platform-tools" "platforms;android-36" "build-tools;36.0.0" "ndk;27.1.12297006" "cmake;3.22.1")
CMDLINE_TOOLS_ZIP=commandlinetools-linux-13114758_latest.zip

log() { echo "[session-start] $*" >&2; }

# 1. JavaScript dependencies (tests, lint, Metro bundle for the APK).
cd "$PROJECT"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  log "npm install"
  npm install --no-audit --no-fund >&2
fi

# 2. Android SDK. Google's download host works fine from the sandbox; only
#    Maven Central is the problem (see step 3).
if [ ! -x "$SDK/cmdline-tools/latest/bin/sdkmanager" ]; then
  log "installing Android command-line tools"
  tmp=$(mktemp -d)
  curl -fsSL --retry 4 --retry-delay 2 -o "$tmp/clt.zip" "https://dl.google.com/android/repository/$CMDLINE_TOOLS_ZIP"
  mkdir -p "$SDK/cmdline-tools"
  unzip -q -o "$tmp/clt.zip" -d "$tmp"
  rm -rf "$SDK/cmdline-tools/latest"
  mv "$tmp/cmdline-tools" "$SDK/cmdline-tools/latest"
  rm -rf "$tmp"
fi

missing=()
for package in "${PACKAGES[@]}"; do
  [ -d "$SDK/${package//;//}" ] || missing+=("$package")
done
if [ ${#missing[@]} -gt 0 ]; then
  log "installing Android SDK packages: ${missing[*]}"
  yes | "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" --licenses >/dev/null 2>&1 || true
  "$SDK/cmdline-tools/latest/bin/sdkmanager" --sdk_root="$SDK" "${missing[@]}" >/dev/null
fi

echo "sdk.dir=$SDK" > "$PROJECT/android/local.properties"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export ANDROID_HOME=$SDK" >> "$CLAUDE_ENV_FILE"
  echo "export ANDROID_SDK_ROOT=$SDK" >> "$CLAUDE_ENV_FILE"
fi

# 3. Maven Central rate-limits the sandbox (random 429/404 in Gradle): send
#    those downloads to Google's mirror. See tools/gradle/google-central.gradle.
mkdir -p "$HOME/.gradle/init.d"
cp "$PROJECT/tools/gradle/google-central.gradle" "$HOME/.gradle/init.d/google-central.gradle"

log "ready: npm test, npm run lint, cd android && ./gradlew assembleRelease"
