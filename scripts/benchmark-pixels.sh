#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${JAVA_HOME:?Set JAVA_HOME to JDK 21}"
: "${ANDROID_HOME:?Set ANDROID_HOME to your Android SDK}"
pixel_serial="${1:?Pass an emulator serial, such as emulator-5556}"
case "$pixel_serial" in emulator-*) ;; *) echo 'This benchmark only runs on an Android emulator.' >&2; exit 1;; esac
pixel_adb="$ANDROID_HOME/platform-tools/adb"
[[ "$("$pixel_adb" -s "$pixel_serial" shell getprop ro.kernel.qemu | tr -d '\r')" == 1 ]] || { echo 'Target is not an emulator.' >&2; exit 1; }
pixel_apk="${2:-platforms/android/app/build/outputs/apk/debug/app-debug.apk}"
pixel_tools="$ANDROID_HOME/build-tools/35.0.0"
pixel_android="$ANDROID_HOME/platforms/android-35/android.jar"
pixel_work="${PIXEL_TEST_OUTPUT_DIR:-../output/t3-pixel-benchmark}"
mkdir -p "$pixel_work/classes" "$pixel_work/dex"
cat > "$pixel_work/AndroidManifest.xml" <<'XML'
<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.faceclaw.t3.pixeltest"><uses-sdk android:minSdkVersion="24" android:targetSdkVersion="35"/><instrumentation android:name="com.faceclaw.t3.pixeltest.PixelBufferInstrumentation" android:targetPackage="com.faceclaw.t3"/><application android:debuggable="true" android:label="T3 pixel benchmark"/></manifest>
XML
"$JAVA_HOME/bin/javac" -source 11 -target 11 -cp "$pixel_android" -d "$pixel_work/classes" tests/android/PixelBufferInstrumentation.java
"$pixel_tools/d8" --lib "$pixel_android" --min-api 24 --output "$pixel_work/dex" "$pixel_work/classes/com/faceclaw/t3/pixeltest/PixelBufferInstrumentation.class"
"$pixel_tools/aapt2" link -I "$pixel_android" --manifest "$pixel_work/AndroidManifest.xml" -o "$pixel_work/base.apk"
python3 - "$pixel_work" <<'PY'
import sys, zipfile
from pathlib import Path
work = Path(sys.argv[1])
with zipfile.ZipFile(work / 'base.apk', 'a') as apk:
    apk.write(work / 'dex/classes.dex', 'classes.dex')
    apk.write('tests/android/pixel-benchmark.js', 'assets/pixel-benchmark.js')
PY
"$pixel_tools/zipalign" -f 4 "$pixel_work/base.apk" "$pixel_work/benchmark.apk"
"$pixel_tools/apksigner" sign --ks "${PIXEL_TEST_KEYSTORE:-$HOME/.android/debug.keystore}" --ks-key-alias androiddebugkey --ks-pass pass:android --key-pass pass:android "$pixel_work/benchmark.apk"
"$pixel_adb" -s "$pixel_serial" install --no-incremental -r "$pixel_apk"
"$pixel_adb" -s "$pixel_serial" install --no-incremental -r "$pixel_work/benchmark.apk"
"$pixel_adb" -s "$pixel_serial" shell am instrument -w com.faceclaw.t3.pixeltest/com.faceclaw.t3.pixeltest.PixelBufferInstrumentation | tee "$pixel_work/results.log"
grep -q '^PASS native ' "$pixel_work/results.log"
