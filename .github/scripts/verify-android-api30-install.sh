#!/usr/bin/env bash
set -euo pipefail

package_service_diagnostics() {
  echo "Android package-service diagnostics"
  adb devices -l || true
  adb shell getprop ro.build.version.sdk || true
  adb shell getprop sys.boot_completed || true
  adb shell getprop dev.bootcomplete || true
  adb shell service list 2>&1 | sed -n '1,80p' || true
}

if ! test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" = "30"; then
  exit 1
fi

if ! timeout 300 sh -c 'until adb shell service check package 2>/dev/null | grep -q "found"; do sleep 2; done'; then
  package_service_diagnostics
  exit 1
fi

if ! timeout 300 sh -c 'until adb shell cmd package list packages >/dev/null 2>&1; do sleep 2; done'; then
  package_service_diagnostics
  exit 1
fi

if ! adb install --no-streaming apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk; then
  package_service_diagnostics
  exit 1
fi

adb shell monkey -p com.thedarkskyxd.streamfusion.dev -c android.intent.category.LAUNCHER 1
timeout 30 sh -c 'until adb shell pidof com.thedarkskyxd.streamfusion.dev; do sleep 1; done'
