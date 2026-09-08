import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateWindowsPortOwnership,
  windowsCleanupPid,
} from "./control-windows-process.mjs";

const profileDir = "C:\\verification runs\\proof\\profile";
const request = { port: 48123, rootPid: 100, profileDir };
const launcher = {
  ProcessId: 100,
  ParentProcessId: 50,
  CreationDate: "launcher-created",
  ExecutablePath: "C:\\node\\node.exe",
  CommandLine: "node npm-cli.js run preview",
};
const launcherIdentity = {
  pid: 100,
  parentPid: 50,
  creationDate: "launcher-created",
  executablePath: "C:\\node\\node.exe",
  commandLine: "node npm-cli.js run preview",
};
const electron = {
  ProcessId: 400,
  ParentProcessId: 300,
  CreationDate: "electron-created",
  ExecutablePath: "C:\\electron\\electron.exe",
  CommandLine: `electron.exe . --remote-debugging-port=48123 "--user-data-dir=${profileDir}"`,
};
const observation = {
  owner: electron,
  chain: [
    electron,
    { ...launcher, ProcessId: 300, ParentProcessId: 100 },
    launcher,
  ],
};

test("pins a listener only after live ancestry and exact arguments match", () => {
  const result = evaluateWindowsPortOwnership(
    { ...request, expectedLauncherProcess: launcherIdentity },
    observation,
  );

  assert.equal(result.belongsToLaunch, true);
  assert.equal(result.launchedByRoot, true);
  assert.equal(result.commandMatches, true);
  assert.deepEqual(result.owner, {
    pid: 400,
    parentPid: 300,
    creationDate: "electron-created",
    executablePath: "C:\\electron\\electron.exe",
    commandLine: electron.CommandLine,
  });
});

test("rejects ownership when both expected identities are missing", () => {
  assert.equal(
    evaluateWindowsPortOwnership(request, observation).belongsToLaunch,
    false,
  );
});

test("rejects a reused launcher PID and incomplete process identities", () => {
  const reusedLauncher = {
    ...launcher,
    CreationDate: "replacement-launcher",
  };
  const incompleteElectron = { ...electron, ExecutablePath: null };

  assert.equal(
    evaluateWindowsPortOwnership(
      { ...request, expectedLauncherProcess: launcherIdentity },
      { ...observation, chain: [electron, reusedLauncher] },
    ).belongsToLaunch,
    false,
  );
  assert.equal(
    evaluateWindowsPortOwnership(
      { ...request, expectedLauncherProcess: launcherIdentity },
      { owner: incompleteElectron, chain: [incompleteElectron, launcher] },
    ).belongsToLaunch,
    false,
  );
  assert.equal(
    evaluateWindowsPortOwnership(
      { ...request, expectedLauncherProcess: launcherIdentity },
      {
        ...observation,
        chain: [electron, { ...launcher, CreationDate: null }],
      },
    ).belongsToLaunch,
    false,
  );
});

test("keeps ownership after disposable launcher ancestors exit", () => {
  const pinned = evaluateWindowsPortOwnership(request, observation).owner;
  const result = evaluateWindowsPortOwnership(
    { ...request, expectedProcess: pinned },
    { owner: electron, chain: [electron] },
  );

  assert.equal(result.launchedByRoot, false);
  assert.equal(result.matchesExpectedProcess, true);
  assert.equal(result.belongsToLaunch, true);
});

test("rejects unrelated, reused, wrong-port, and wrong-profile listeners", () => {
  const pinned = evaluateWindowsPortOwnership(request, observation).owner;
  const cases = [
    { owner: { ...electron, ProcessId: 401 }, chain: [] },
    { owner: { ...electron, CreationDate: "reused-pid" }, chain: [] },
    {
      owner: {
        ...electron,
        CommandLine: electron.CommandLine.replace("48123", "48124"),
      },
      chain: [],
    },
    {
      owner: {
        ...electron,
        CommandLine: electron.CommandLine.replace(profileDir, `${profileDir}-stale`),
      },
      chain: [],
    },
  ];

  for (const candidate of cases) {
    const result = evaluateWindowsPortOwnership(
      { ...request, expectedProcess: pinned },
      candidate,
    );
    assert.equal(result.belongsToLaunch, false);
  }
});

test("cleanup rejects legacy state without a pinned listener", () => {
  let portRead = false;
  const pid = windowsCleanupPid(
    {
      pid: 100,
      port: 48123,
      profileDir,
      launcherProcess: launcherIdentity,
    },
    {
      readProcess: () => ({
        ...launcherIdentity,
        creationDate: "reused-launcher-pid",
      }),
      readPortOwnership: () => {
        portRead = true;
        return { belongsToLaunch: true, ownerPid: 400 };
      },
    },
  );

  assert.equal(pid, null);
  assert.equal(portRead, false);
});
