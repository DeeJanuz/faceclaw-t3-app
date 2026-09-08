#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ -f build_paths.sh ]]; then source build_paths.sh; fi
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
: "${ANDROID_HOME:?Set ANDROID_HOME to your SDK}"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
npm exec --package=nativescript@9.1.1 -- ns build android --no-hmr "$@"
