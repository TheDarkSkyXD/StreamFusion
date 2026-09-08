import { spawnSync } from "node:child_process";

function isCompleteIdentity(identity) {
  return Boolean(
    identity &&
      Number.isInteger(identity.pid) &&
      identity.pid > 0 &&
      Number.isInteger(identity.parentPid) &&
      identity.parentPid >= 0 &&
      identity.creationDate &&
      identity.executablePath,
  );
}

function processIdentity(record) {
  if (!record) return null;
  const identity = {
    pid: Number(record.ProcessId),
    parentPid: Number(record.ParentProcessId),
    creationDate: String(record.CreationDate ?? ""),
    executablePath: String(record.ExecutablePath ?? ""),
    commandLine: String(record.CommandLine ?? ""),
  };
  return isCompleteIdentity(identity) ? identity : null;
}

function sameProcess(left, right) {
  return Boolean(
    isCompleteIdentity(left) &&
      isCompleteIdentity(right) &&
      left.pid === right.pid &&
      left.creationDate === right.creationDate &&
      left.executablePath.toLowerCase() === right.executablePath.toLowerCase(),
  );
}

function hasExactSwitch(commandLine, name, value) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const argument = `--${escape(name)}=${escape(value)}`;
  return new RegExp(`(?:^|\\s)(?:"${argument}"|${argument})(?=\\s|$)`).test(
    commandLine,
  );
}

export function evaluateWindowsPortOwnership(
  {
    port,
    profileDir,
    expectedLauncherProcess = null,
    expectedProcess = null,
  },
  observation,
) {
  const owner = processIdentity(observation.owner);
  const chain = observation.chain.map(processIdentity).filter(Boolean);
  const commandMatches = Boolean(
    owner &&
      hasExactSwitch(owner.commandLine, "remote-debugging-port", String(port)) &&
      hasExactSwitch(owner.commandLine, "user-data-dir", profileDir),
  );
  const launchedByRoot = expectedLauncherProcess
    ? chain.some((record) => sameProcess(record, expectedLauncherProcess))
    : false;
  const matchesExpectedProcess = expectedProcess
    ? sameProcess(owner, expectedProcess)
    : true;
  return {
    ownerPid: owner?.pid ?? null,
    chain: chain.map((record) => record.pid),
    belongsToLaunch:
      commandMatches && matchesExpectedProcess && (expectedProcess ? true : launchedByRoot),
    commandMatches,
    launchedByRoot,
    matchesExpectedProcess,
    owner,
  };
}

function powershellProcessExpression(pidExpression) {
  return `Get-CimInstance Win32_Process -Filter \"ProcessId = $(${pidExpression})\" -ErrorAction SilentlyContinue | Select-Object ProcessId,ParentProcessId,CreationDate,ExecutablePath,CommandLine`;
}

export function readWindowsProcess(pid) {
  const source = `${powershellProcessExpression(String(pid))} | ConvertTo-Json -Compress`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", source],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return processIdentity(JSON.parse(result.stdout));
}

export function readWindowsPortOwnership(request) {
  const source = [
    `$ownerPid = (Get-NetTCPConnection -State Listen -LocalPort ${request.port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
    `$owner = ${powershellProcessExpression("$ownerPid")}`,
    "$chain = @()",
    "$current = $ownerPid",
    "while ($current -and $current -gt 0 -and -not ($chain.ProcessId -contains $current)) {",
    `  $record = ${powershellProcessExpression("$current")}`,
    "  if (-not $record) { break }",
    "  $chain += $record",
    "  $current = [int]$record.ParentProcessId",
    "}",
    "[pscustomobject]@{ owner = $owner; chain = $chain } | ConvertTo-Json -Compress -Depth 4",
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", source],
    { encoding: "utf8" },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return {
      ownerPid: null,
      chain: [],
      belongsToLaunch: false,
      commandMatches: false,
      launchedByRoot: false,
      matchesExpectedProcess: false,
      owner: null,
      error: result.stderr.trim(),
    };
  }
  return evaluateWindowsPortOwnership(request, JSON.parse(result.stdout));
}

export function readWindowsPortListenerPid(port) {
  const source = `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`;
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", source],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Could not inspect CDP port ${port}: ${result.stderr.trim()}`);
  }
  const pid = Number(result.stdout.trim());
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function windowsProcessMatches(expected, current) {
  return sameProcess(expected, current);
}

export function windowsCleanupPid(
  state,
  {
    readProcess = readWindowsProcess,
    readPortOwnership = readWindowsPortOwnership,
  } = {},
) {
  const currentLauncher = readProcess(state.pid);
  if (windowsProcessMatches(state.launcherProcess, currentLauncher)) {
    return state.pid;
  }
  if (!state.listenerProcess) return null;
  const ownership = readPortOwnership({
    port: state.port,
    profileDir: state.profileDir,
    expectedProcess: state.listenerProcess,
  });
  return ownership.belongsToLaunch ? ownership.ownerPid : null;
}
