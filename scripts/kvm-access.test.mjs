import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import test from "node:test";

const enableKvmScript = ".github/scripts/enable-kvm-access.sh";

function privileged(args, extra = {}) {
  return spawnSync("sudo", args, {
    encoding: "utf8",
    timeout: 10_000,
    ...extra,
  });
}

function createRestrictedKvmNode(directory) {
  const device = path.join(directory, "kvm");
  const created = privileged(["mknod", device, "c", "10", "232"]);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(privileged(["chmod", "0660", device]).status, 0);
  assert.equal(privileged(["chown", "root:root", device]).status, 0);
  return device;
}

function writeUdevadmStub(directory) {
  const stub = path.join(directory, "udevadm");
  writeFileSync(
    stub,
    `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "\${UDEVADM_LOG:?}"
`,
  );
  chmodSync(stub, 0o755);
  return stub;
}

function runEnableKvm(directory, device, extraEnv = {}) {
  return spawnSync("bash", [enableKvmScript], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      KVM_DEVICE: device,
      UDEV_RULES_FILE: path.join(directory, "99-kvm4all.rules"),
      UDEVADM: path.join(directory, "udevadm"),
      UDEVADM_LOG: path.join(directory, "udevadm.log"),
      RETRY_COUNT: "2",
      RETRY_SLEEP_SECONDS: "0",
      SETTLE_TIMEOUT_SECONDS: "1",
      ...extraEnv,
    },
  });
}

test("the GitHub udev snippet without chmod leaves a 0660 kvm node unwritable", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".kvm-repro-"));
  const device = createRestrictedKvmNode(directory);
  const udevadm = writeUdevadmStub(directory);
  const rules = path.join(directory, "99-kvm4all.rules");

  try {
    assert.equal(spawnSync("test", ["-c", device]).status, 0);
    assert.equal(spawnSync("test", ["-r", device]).status, 1);
    assert.equal(spawnSync("test", ["-w", device]).status, 1);

    const snippet = spawnSync(
      "bash",
      [
        "-c",
        [
          `echo 'KERNEL=="kvm", GROUP="kvm", MODE="0666", OPTIONS+="static_node=kvm"' | tee ${JSON.stringify(rules)}`,
          `${JSON.stringify(udevadm)} control --reload-rules`,
          `${JSON.stringify(udevadm)} trigger --name-match=kvm`,
          `test -c ${JSON.stringify(device)}`,
          `test -r ${JSON.stringify(device)}`,
          `test -w ${JSON.stringify(device)}`,
        ].join(" && "),
      ],
      {
        cwd: directory,
        encoding: "utf8",
        env: {
          ...process.env,
          UDEVADM_LOG: path.join(directory, "udevadm.log"),
        },
        timeout: 10_000,
      },
    );

    assert.equal(snippet.status, 1, snippet.stdout + snippet.stderr);
    assert.equal(spawnSync("test", ["-r", device]).status, 1);
    assert.equal(spawnSync("test", ["-w", device]).status, 1);
  } finally {
    privileged(["rm", "-f", device]);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("enable-kvm-access.sh makes a 0660 kvm node readable and writable after a no-op udev", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".kvm-enable-"));
  const device = createRestrictedKvmNode(directory);
  writeUdevadmStub(directory);

  try {
    const result = runEnableKvm(directory, device);

    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /KVM diagnostics \(before\)/);
    assert.match(result.stdout, /KVM diagnostics \(after\)/);
    assert.match(
      readFileSync(path.join(directory, "99-kvm4all.rules"), "utf8"),
      /KERNEL=="kvm".*MODE="0666".*static_node=kvm/,
    );
    assert.match(
      readFileSync(path.join(directory, "udevadm.log"), "utf8"),
      /control --reload-rules/,
    );
    assert.match(
      readFileSync(path.join(directory, "udevadm.log"), "utf8"),
      /trigger --name-match=kvm/,
    );
    assert.match(
      readFileSync(path.join(directory, "udevadm.log"), "utf8"),
      /settle --timeout=1/,
    );
    assert.equal(spawnSync("test", ["-c", device]).status, 0);
    assert.equal(spawnSync("test", ["-r", device]).status, 0);
    assert.equal(spawnSync("test", ["-w", device]).status, 0);
  } finally {
    privileged(["rm", "-f", device]);
    rmSync(directory, { recursive: true, force: true });
  }
});

test("enable-kvm-access.sh fails closed with a re-run message when the kvm node is absent", () => {
  const directory = mkdtempSync(path.join(process.cwd(), ".kvm-missing-"));
  writeUdevadmStub(directory);
  const device = path.join(directory, "missing-kvm");

  try {
    const result = runEnableKvm(directory, device, { RETRY_COUNT: "1" });

    assert.equal(result.status, 75, result.stdout + result.stderr);
    assert.match(result.stdout, /KVM diagnostics \(before\)/);
    assert.match(result.stdout, /is absent/);
    assert.match(result.stdout, /nested virtualization/);
    assert.match(result.stdout, /Re-run this job/);
    assert.doesNotMatch(result.stdout, /-accel off/);
    assert.equal(existsSync(device), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
