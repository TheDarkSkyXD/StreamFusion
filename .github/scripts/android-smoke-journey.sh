#!/usr/bin/env bash
set -euo pipefail

APK_PATH="${APK_PATH:-apps/mobile/android/app/build/outputs/apk/debug/app-debug.apk}"
PACKAGE_NAME="${PACKAGE_NAME:-com.thedarkskyxd.streamfusion.dev}"
EVIDENCE_DIR="${ANDROID_GATE_EVIDENCE_DIR:-artifacts/mobile-evidence/android-smoke}"
REPORT_PATH="${ANDROID_GATE_JOURNEY_REPORT:-${EVIDENCE_DIR}/journey.json}"
mkdir -p "$EVIDENCE_DIR" "$(dirname "$REPORT_PATH")"

dump_ui() {
  adb shell uiautomator dump /sdcard/streamfusion-window.xml >/dev/null
  adb pull /sdcard/streamfusion-window.xml "${EVIDENCE_DIR}/window.xml" >/dev/null
}

await_test_id() {
  local test_id="$1"
  local attempts=0
  until dump_ui && grep -Fq "$test_id" "${EVIDENCE_DIR}/window.xml"; do
    attempts=$((attempts + 1))
    test "$attempts" -lt 30 || return 1
    sleep 1
  done
}

tap_test_id() {
  local test_id="$1"
  local node bounds left top right bottom
  await_test_id "$test_id"
  node="$(grep -F "$test_id" "${EVIDENCE_DIR}/window.xml" | head -n 1)"
  bounds="$(printf '%s' "$node" | sed -n 's/.*bounds="\[\([0-9]*\),\([0-9]*\)\]\[\([0-9]*\),\([0-9]*\)\]".*/\1 \2 \3 \4/p')"
  read -r left top right bottom <<<"$bounds"
  test -n "${right:-}" && test -n "${bottom:-}"
  adb shell input tap "$(((left + right) / 2))" "$(((top + bottom) / 2))"
}

capture() {
  local name="$1"
  adb exec-out screencap -p > "${EVIDENCE_DIR}/${name}.png"
  test -s "${EVIDENCE_DIR}/${name}.png"
}

run_step() {
  local navigation="$1"
  local screen="$2"
  tap_test_id "$navigation"
  await_test_id "$screen"
  capture "$screen"
}

test "$(adb shell getprop ro.build.version.sdk | tr -d '\r')" -ge 30
adb install --no-streaming "$APK_PATH"
adb shell monkey -p "$PACKAGE_NAME" -c android.intent.category.LAUNCHER 1 >/dev/null
await_test_id "app-shell-ready"
capture "app-shell-ready"
run_step "nav-search" "screen-search-root"
run_step "nav-following" "screen-following-root"
run_step "nav-watch" "screen-watch-root"
run_step "nav-activity" "screen-activity-root"
run_step "nav-more" "screen-more-root"
printf '{"journey":"shell-navigation","result":"pass"}\n' > "$REPORT_PATH"
