#!/usr/bin/env bash
set -euo pipefail

KVM_DEVICE="${KVM_DEVICE:-/dev/kvm}"
UDEV_RULES_FILE="${UDEV_RULES_FILE:-/etc/udev/rules.d/99-kvm4all.rules}"
UDEVADM="${UDEVADM:-udevadm}"
RETRY_COUNT="${RETRY_COUNT:-5}"
RETRY_SLEEP_SECONDS="${RETRY_SLEEP_SECONDS:-1}"
SETTLE_TIMEOUT_SECONDS="${SETTLE_TIMEOUT_SECONDS:-10}"
SUDO="${SUDO-sudo}"

run_privileged() {
  if [[ -n "$SUDO" ]]; then
    "$SUDO" "$@"
  else
    "$@"
  fi
}

kvm_ready() {
  test -c "$KVM_DEVICE" && test -r "$KVM_DEVICE" && test -w "$KVM_DEVICE"
}

log_diagnostics() {
  local label=$1
  echo "KVM diagnostics ($label)"
  echo "host=$(uname -a)"
  echo "id=$(id)"
  echo "groups=$(id -nG 2>/dev/null || true)"
  if [[ -e "$KVM_DEVICE" ]]; then
    ls -l "$KVM_DEVICE" || true
    stat "$KVM_DEVICE" || true
  else
    echo "$KVM_DEVICE is absent"
  fi
  if [[ -r /proc/cpuinfo ]]; then
    if grep -E -q -m1 '(^|[[:space:]])(vmx|svm)([[:space:]]|$)' /proc/cpuinfo; then
      echo "cpu virt flags: present"
    else
      echo "cpu virt flags: missing vmx/svm"
    fi
  fi
}

apply_udev_rule() {
  echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' |
    run_privileged tee "$UDEV_RULES_FILE"
  run_privileged "$UDEVADM" control --reload-rules || true
  run_privileged "$UDEVADM" trigger --name-match=kvm || true
  run_privileged "$UDEVADM" settle --timeout="$SETTLE_TIMEOUT_SECONDS" || true
}

grant_access() {
  if [[ -e "$KVM_DEVICE" ]]; then
    run_privileged chmod 0666 "$KVM_DEVICE" || true
  fi
}

log_diagnostics before

attempt=1
while ((attempt <= RETRY_COUNT)); do
  apply_udev_rule
  grant_access
  if kvm_ready; then
    log_diagnostics after
    echo "KVM is a readable and writable character device: $KVM_DEVICE"
    exit 0
  fi
  echo "KVM is not ready (attempt ${attempt}/${RETRY_COUNT})"
  if ((attempt < RETRY_COUNT)); then
    sleep "$RETRY_SLEEP_SECONDS"
  fi
  attempt=$((attempt + 1))
done

log_diagnostics after

if [[ ! -e "$KVM_DEVICE" ]]; then
  echo "This GitHub-hosted runner did not expose $KVM_DEVICE after udev."
  echo "Linux nested virtualization is experimental on GitHub-hosted runners."
  echo "Re-run this job to land on a new VM. Do not disable emulator acceleration."
  echo "Docs: https://docs.github.com/en/actions/concepts/runners/github-hosted-runners"
  echo "Changelog: https://github.blog/changelog/2024-04-02-github-actions-hardware-accelerated-android-virtualization-now-available/"
  exit 75
fi

echo "$KVM_DEVICE exists but this user cannot read and write it after MODE=0666."
echo "id=$(id)"
ls -l "$KVM_DEVICE" || true
exit 1
