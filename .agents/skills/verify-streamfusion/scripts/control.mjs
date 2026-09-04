#!/usr/bin/env node

import { execFileSync, spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import {
  createVerificationLaunchPlan,
  runManagedVerificationSession,
} from "./control-launch-plan.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..", "..", "..", "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const verificationRoot = path.join(repoRoot, ".scratch", "verify-streamfusion");
const runsRoot = path.join(verificationRoot, "runs");
const evidenceRoot = path.join(verificationRoot, "evidence");
const requiredDatabaseTables = [
  "key_value",
  "local_follows",
  "mod_log",
  "mod_log_coverage",
  "pending_follow_writes",
  "retention_settings",
];

function parseArguments(argv) {
  const [command, ...tokens] = argv;
  const options = {};
  const electronArgs = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--") {
      electronArgs.push(...tokens.slice(index + 1));
      break;
    }
    if (!token.startsWith("--"))
      throw new Error(`Unexpected argument: ${token}`);
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      options[key] = inlineValue;
      continue;
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) options[key] = true;
    else {
      options[key] = value;
      index += 1;
    }
  }
  return { command, options, electronArgs };
}

function requireOption(options, name) {
  const value = options[name];
  if (typeof value !== "string" || !value) throw new Error(`Missing --${name}`);
  return value;
}

function json(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function safeRunDirectory(runDirectory) {
  const resolved = path.resolve(runDirectory);
  if (path.dirname(resolved) !== path.resolve(runsRoot)) {
    throw new Error(`Refusing run directory outside ${runsRoot}`);
  }
  return resolved;
}

function safeEvidencePath(state, requested, extension) {
  const base = path.resolve(state.evidenceDir);
  const filename = requested || `${Date.now()}${extension}`;
  const resolved = path.resolve(base, filename);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`Refusing evidence path outside ${base}`);
  }
  return resolved;
}

async function readState(runFile) {
  const resolved = path.resolve(runFile);
  const state = JSON.parse(await readFile(resolved, "utf8"));
  if (path.resolve(state.runFile) !== resolved)
    throw new Error("Run file identity mismatch");
  safeRunDirectory(state.runDir);
  return state;
}

async function readCleanupState(runFile) {
  const resolved = path.resolve(runFile);
  if (existsSync(resolved)) return readState(resolved);
  const id = path.basename(path.dirname(resolved));
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error(`Invalid run id in ${resolved}`);
  const recoveryFile = path.join(evidenceRoot, id, "cleanup-state.json");
  const state = JSON.parse(await readFile(recoveryFile, "utf8"));
  if (path.resolve(state.runFile) !== resolved)
    throw new Error("Cleanup state identity mismatch");
  safeRunDirectory(state.runDir);
  return state;
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("Could not reserve a CDP port"));
        else resolve(port);
      });
    });
  });
}

async function assertKnownPortsAreFree() {
  for (const port of [9222, 9236]) {
    try {
      const target = await getAppTarget(port);
      throw new Error(
        `StreamFusion is already running on CDP port ${port} at ${target.url}. Close it before starting an isolated verification run.`,
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("StreamFusion is already running")
      ) {
        throw error;
      }
    }
  }
}

async function assertNoActiveVerificationRun() {
  if (!existsSync(runsRoot)) return;
  const { readdir } = await import("node:fs/promises");
  for (const entry of await readdir(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(runsRoot, entry.name, "run.json");
    if (!existsSync(candidate)) continue;
    try {
      const state = JSON.parse(await readFile(candidate, "utf8"));
      if (isProcessAlive(state.pid)) {
        throw new Error(
          `Verification run ${state.id} is still active. Clean it up before launching another run.`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("Verification run")
      )
        throw error;
    }
  }
}

async function getTargets(port) {
  const response = await fetch(`http://127.0.0.1:${port}/json/list`, {
    signal: AbortSignal.timeout(2_000),
  });
  if (!response.ok)
    throw new Error(`CDP target request returned HTTP ${response.status}`);
  return response.json();
}

async function getAppTarget(port) {
  const targets = await getTargets(port);
  const target = targets.find(
    (candidate) =>
      candidate.type === "page" &&
      candidate.webSocketDebuggerUrl &&
      (candidate.title === "StreamFusion" ||
        /localhost|index\.html/i.test(candidate.url ?? "")),
  );
  if (!target)
    throw new Error(`No StreamFusion page target found on CDP port ${port}`);
  return target;
}

async function waitForTarget(port, rootPid, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (!isProcessAlive(rootPid))
      throw new Error(`Launcher process ${rootPid} exited before ready`);
    try {
      const target = await getAppTarget(port);
      if (target.title !== "StreamFusion") {
        throw new Error(
          `StreamFusion page title is not ready: ${JSON.stringify(target.title)}`,
        );
      }
      const page = await cdpCall(port, "Runtime.evaluate", {
        expression: "Boolean(document.body?.innerText && window.electronAPI)",
        returnByValue: true,
      });
      if (page.result?.value !== true)
        throw new Error("Renderer body or preload bridge is not ready");
      return target;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(
    `StreamFusion was not ready after ${timeoutMs}ms: ${String(lastError)}`,
  );
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cdpCall(port, method, params = {}) {
  const target = await getAppTarget(port);
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} timed out`));
    }, 15_000);

    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timeout);
      socket.close();
      if (message.error)
        reject(new Error(`CDP ${method}: ${message.error.message}`));
      else resolve(message.result);
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error(`Could not connect to ${target.webSocketDebuggerUrl}`));
    });
  });
}

async function evaluate(state, expression) {
  const response = await cdpCall(state.port, "Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (response.exceptionDetails) {
    const detail =
      response.exceptionDetails.exception?.description ||
      response.exceptionDetails.text;
    throw new Error(detail);
  }
  return response.result?.value;
}

function elementExpression({ role, name, action, value, key }) {
  return `(() => {
    const wantedRole = ${JSON.stringify(role)};
    const wantedName = ${JSON.stringify(name)};
    const implicitRole = (element) => {
      if (element.getAttribute('role')) return element.getAttribute('role');
      const tag = element.tagName.toLowerCase();
      if (tag === 'a' && element.hasAttribute('href')) return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'input') {
        const type = (element.getAttribute('type') || 'text').toLowerCase();
        if (type === 'search') return 'searchbox';
        if (['text', 'email', 'url', 'tel', 'password'].includes(type)) return 'textbox';
        if (type === 'checkbox') return 'checkbox';
      }
      if (tag === 'textarea') return 'textbox';
      if (/^h[1-6]$/.test(tag)) return 'heading';
      return '';
    };
    const accessibleName = (element) =>
      (element.getAttribute('aria-label') ||
        element.getAttribute('title') ||
        element.getAttribute('placeholder') ||
        element.textContent || '').trim().replace(/\\s+/g, ' ');
    const element = Array.from(document.querySelectorAll('a,button,input,textarea,select,h1,h2,h3,h4,h5,h6,[role]'))
      .find((candidate) =>
        implicitRole(candidate) === wantedRole &&
        accessibleName(candidate).toLowerCase() === wantedName.toLowerCase() &&
        candidate.getClientRects().length > 0
      );
    if (!element) throw new Error('No visible ' + wantedRole + ' named "' + wantedName + '"');
    const before = {
      url: location.href,
      role: implicitRole(element),
      name: accessibleName(element),
      disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
      value: 'value' in element ? element.value : undefined,
    };
    if (${JSON.stringify(action)} === 'click') element.click();
    if (${JSON.stringify(action)} === 'fill') {
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), 'value')?.set;
      if (!setter) throw new Error('Target does not accept text');
      setter.call(element, ${JSON.stringify(value)});
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (${JSON.stringify(action)} === 'press') {
      element.focus();
      element.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent('keyup', { key: ${JSON.stringify(key)}, bubbles: true }));
    }
    return { before, action: ${JSON.stringify(action)}, urlAfterAction: location.href };
  })()`;
}

async function appendAction(state, command, result) {
  const entry = { at: new Date().toISOString(), command, result };
  await mkdir(state.evidenceDir, { recursive: true });
  const actionPath = path.join(state.evidenceDir, "actions.ndjson");
  const prior = existsSync(actionPath)
    ? await readFile(actionPath, "utf8")
    : "";
  await writeFile(actionPath, `${prior}${JSON.stringify(entry)}\n`, "utf8");
}

function getGitRevision() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "unknown";
  }
}

function defaultLiveDatabasePath() {
  return path.join(defaultLiveProfilePath(), "streamfusion.db");
}

function defaultLiveProfilePath() {
  return path.join(repoRoot, ".streamfusion-dev-user-data");
}

async function seedLiveDatabase(options, profileDir) {
  const source = path.resolve(
    typeof options.database === "string"
      ? options.database
      : defaultLiveDatabasePath(),
  );
  if (!existsSync(source)) return null;

  const destination = path.join(profileDir, "streamfusion.db");
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.prepare("VACUUM INTO ?").run(destination);
  } finally {
    database.close();
  }
  return { source, destination };
}

async function copyIfPresent(source, destination) {
  if (!existsSync(source)) return null;
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, await readFile(source));
  return { source, destination };
}

async function snapshotSqliteIfPresent(source, destination) {
  if (!existsSync(source)) return null;
  await mkdir(path.dirname(destination), { recursive: true });
  const database = new DatabaseSync(source, { readOnly: true });
  try {
    database.prepare("VACUUM INTO ?").run(destination);
  } finally {
    database.close();
  }
  return { source, destination };
}

async function seedLiveAccountStorage(options, profileDir) {
  const source = path.resolve(
    typeof options.storage === "string"
      ? options.storage
      : path.join(defaultLiveProfilePath(), "streamfusion-storage.json"),
  );
  if (!existsSync(source)) return null;

  const serialized = await readFile(source, "utf8");
  const stored = JSON.parse(serialized);
  const authTokens =
    stored && typeof stored === "object" && !Array.isArray(stored)
      ? stored.authTokens
      : null;
  const authenticatedPlatforms =
    authTokens && typeof authTokens === "object" && !Array.isArray(authTokens)
      ? ["twitch", "kick"].filter((platform) => platform in authTokens)
      : [];

  const destination = path.join(profileDir, "streamfusion-storage.json");
  await writeFile(destination, serialized, "utf8");
  const sourceProfile = path.dirname(source);
  const encryptionState = await copyIfPresent(
    path.join(sourceProfile, "Local State"),
    path.join(profileDir, "Local State"),
  );
  const cookies = await snapshotSqliteIfPresent(
    path.join(sourceProfile, "Network", "Cookies"),
    path.join(profileDir, "Network", "Cookies"),
  );
  return {
    source,
    destination,
    encryptionState,
    cookies,
    authenticatedPlatforms,
  };
}

async function launch(options, electronArgs = [], { managed = false } = {}) {
  await assertKnownPortsAreFree();
  await assertNoActiveVerificationRun();
  const id =
    typeof options.id === "string"
      ? options.id
      : new Date().toISOString().replace(/[:.]/g, "-");
  if (!/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error(
      "Run id may contain letters, digits, underscores, and hyphens only",
    );
  const runDir = safeRunDirectory(path.join(runsRoot, id));
  const evidenceDir = path.join(evidenceRoot, id);
  if (existsSync(runDir)) throw new Error(`Run already exists: ${runDir}`);

  const port = options.port ? Number(options.port) : await findFreePort();
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid --port");
  const profileDir = path.join(runDir, "profile");
  const artifactRoot = path.join(runDir, "dev-artifacts");
  const runFile = path.join(runDir, "run.json");
  const logFile = path.join(evidenceDir, "launch.log");
  const plan = createVerificationLaunchPlan({
    mode: options.mode,
    port,
    profileDir,
    electronArgs,
  });
  await mkdir(profileDir, { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(evidenceDir, { recursive: true });
  const databaseSeed = await seedLiveDatabase(options, profileDir);
  const accountStorageSeed = await seedLiveAccountStorage(options, profileDir);

  const outputFd = openSync(logFile, "a");
  const child = spawn(plan.command, plan.args, {
    cwd: desktopRoot,
    detached: true,
    windowsHide: true,
    env: {
      ...plan.env,
      STREAMFUSION_DEV_ARTIFACT_ROOT: artifactRoot,
      STREAMFUSION_DEV_USER_DATA_DIR: profileDir,
    },
    stdio: ["ignore", outputFd, outputFd],
  });
  closeSync(outputFd);
  if (!managed) child.unref();

  const packageJson = JSON.parse(
    await readFile(path.join(desktopRoot, "package.json"), "utf8"),
  );
  const state = {
    id,
    pid: child.pid,
    port,
    runDir,
    runFile,
    profileDir,
    artifactRoot,
    evidenceDir,
    logFile,
    databaseSeed,
    accountStorageSeed,
    launcher: plan.launcher,
    packageVersion: packageJson.version,
    gitRevision: getGitRevision(),
    launchedAt: new Date().toISOString(),
  };
  await writeFile(runFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  try {
    const target = await waitForTarget(
      port,
      child.pid,
      plan.readinessTimeoutMs,
    );
    return {
      state,
      child,
      report: { ...state, title: target.title, url: target.url, ready: true },
    };
  } catch (error) {
    await stopProcessTree(child.pid);
    await removeRunScratch(state);
    throw new Error(`${String(error)}. Launch log retained at ${logFile}`);
  }
}

function windowsPortOwnership(port, rootPid) {
  const source = [
    `$owner = (Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty OwningProcess)`,
    "$chain = @()",
    "$current = $owner",
    "while ($current -and $current -gt 0 -and -not ($chain -contains $current)) {",
    "  $chain += $current",
    '  $record = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue',
    "  if (-not $record) { break }",
    "  $current = [int]$record.ParentProcessId",
    "}",
    `[pscustomobject]@{ ownerPid = $owner; chain = $chain; belongsToLaunch = ($chain -contains ${rootPid}) } | ConvertTo-Json -Compress`,
  ].join("; ");
  const result = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", source],
    {
      encoding: "utf8",
    },
  );
  if (result.status !== 0 || !result.stdout.trim()) {
    return {
      ownerPid: null,
      chain: [],
      belongsToLaunch: false,
      error: result.stderr.trim(),
    };
  }
  return JSON.parse(result.stdout);
}

function unixPortOwnership(port, rootPid) {
  const ownerResult = spawnSync(
    "lsof",
    ["-nP", "-t", `-iTCP:${port}`, "-sTCP:LISTEN"],
    {
      encoding: "utf8",
    },
  );
  const ownerPid = Number(ownerResult.stdout.trim().split(/\s+/)[0]);
  if (!ownerPid) return { ownerPid: null, chain: [], belongsToLaunch: false };
  const chain = [];
  let current = ownerPid;
  while (current > 0 && !chain.includes(current)) {
    chain.push(current);
    const parent = spawnSync("ps", ["-o", "ppid=", "-p", String(current)], {
      encoding: "utf8",
    });
    current = Number(parent.stdout.trim());
  }
  return { ownerPid, chain, belongsToLaunch: chain.includes(rootPid) };
}

async function doctor(options) {
  const state = await readState(requireOption(options, "run"));
  const target = await getAppTarget(state.port);
  const page = await evaluate(
    state,
    `({ title: document.title, url: location.href, bridgeAvailable: Boolean(window.electronAPI), bodyReady: Boolean(document.body?.innerText) })`,
  );
  const ownership =
    process.platform === "win32"
      ? windowsPortOwnership(state.port, state.pid)
      : unixPortOwnership(state.port, state.pid);
  const currentVersion = JSON.parse(
    await readFile(path.join(desktopRoot, "package.json"), "utf8"),
  ).version;
  const logText = existsSync(state.logFile)
    ? await readFile(state.logFile, "utf8")
    : "";
  const uncaughtErrors = logText
    .split(/\r?\n/)
    .filter((line) =>
      /Uncaught|UnhandledPromiseRejection|TypeError:/i.test(line),
    )
    .slice(-20);
  const accountStorageErrors = logText
    .split(/\r?\n/)
    .filter((line) => /Failed to decrypt token/i.test(line))
    .slice(-20);
  const result = {
    healthy:
      isProcessAlive(state.pid) &&
      ownership.belongsToLaunch &&
      page.title === "StreamFusion" &&
      page.bridgeAvailable &&
      page.bodyReady &&
      accountStorageErrors.length === 0 &&
      currentVersion === state.packageVersion,
    launcherPid: state.pid,
    port: state.port,
    portOwnership: ownership,
    target: { title: target.title, url: target.url },
    page,
    packageVersion: currentVersion,
    launchedVersion: state.packageVersion,
    launcher: state.launcher,
    gitRevision: state.gitRevision,
    authentication: !state.accountStorageSeed
      ? "No development account store was available; this run started signed out"
      : `Seeded development account state for: ${state.accountStorageSeed.authenticatedPlatforms.join(", ") || "no authenticated platforms"}`,
    accountStorageErrors,
    uncaughtErrors,
    evidenceDir: state.evidenceDir,
  };
  json(result);
  if (!result.healthy) process.exitCode = 1;
}

async function interact(command, options) {
  const state = await readState(requireOption(options, "run"));
  const role = requireOption(options, "role");
  const name = requireOption(options, "name");
  const result = await evaluate(
    state,
    elementExpression({
      role,
      name,
      action: command,
      value: typeof options.value === "string" ? options.value : "",
      key: typeof options.key === "string" ? options.key : "",
    }),
  );
  await appendAction(state, command, result);
  json(result);
}

async function inspectElement(options) {
  const state = await readState(requireOption(options, "run"));
  const result = await evaluate(
    state,
    elementExpression({
      role: requireOption(options, "role"),
      name: requireOption(options, "name"),
      action: "inspect",
      value: "",
      key: "",
    }),
  );
  json(result.before);
}

async function wait(options) {
  const state = await readState(requireOption(options, "run"));
  const timeoutMs = options.timeout ? Number(options.timeout) : 15_000;
  const deadline = Date.now() + timeoutMs;
  let lastValue;
  while (Date.now() < deadline) {
    lastValue = await evaluate(
      state,
      `(() => {
        const text = ${JSON.stringify(typeof options.text === "string" ? options.text : "")};
        const hash = ${JSON.stringify(typeof options.hash === "string" ? options.hash : "")};
        const textMatches = !text || document.body.innerText.includes(text);
        const hashMatches = !hash || location.hash.includes(hash);
        return { matched: textMatches && hashMatches, url: location.href, textFound: textMatches, hashFound: hashMatches };
      })()`,
    );
    if (lastValue.matched) {
      json(lastValue);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(
    `Wait timed out after ${timeoutMs}ms: ${JSON.stringify(lastValue)}`,
  );
}

async function snapshot(options) {
  const state = await readState(requireOption(options, "run"));
  const output = safeEvidencePath(state, options.output, ".snapshot.json");
  const result = await evaluate(
    state,
    `(() => {
      const roleOf = (element) => element.getAttribute('role') || ({ A: 'link', BUTTON: 'button', INPUT: element.type === 'search' ? 'searchbox' : 'textbox', TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading' }[element.tagName] || '');
      const nameOf = (element) => (element.getAttribute('aria-label') || element.getAttribute('title') || element.getAttribute('placeholder') || element.textContent || '').trim().replace(/\\s+/g, ' ');
      const elements = Array.from(document.querySelectorAll('a,button,input,textarea,select,h1,h2,h3,[role]'))
        .filter((element) => element.getClientRects().length > 0)
        .slice(0, 300)
        .map((element) => ({
          role: roleOf(element),
          name: nameOf(element),
          disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'),
          selected: element.getAttribute('aria-selected'),
          pressed: element.getAttribute('aria-pressed'),
          value: 'value' in element ? element.value : undefined,
        }));
      return { capturedAt: new Date().toISOString(), title: document.title, url: location.href, text: document.body.innerText, elements };
    })()`,
  );
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  json({
    output,
    title: result.title,
    url: result.url,
    elementCount: result.elements.length,
  });
}

async function screenshot(options) {
  const state = await readState(requireOption(options, "run"));
  const output = safeEvidencePath(state, options.output, ".png");
  const response = await cdpCall(state.port, "Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, Buffer.from(response.data, "base64"));
  json({ output, bytes: Buffer.byteLength(response.data, "base64") });
}

async function rawEvaluate(options) {
  const state = await readState(requireOption(options, "run"));
  const expression = requireOption(options, "expression");
  const result = await evaluate(state, expression);
  await appendAction(state, "evaluate", result);
  json(result);
}

async function logs(options) {
  const state = await readState(requireOption(options, "run"));
  const count = options.lines ? Number(options.lines) : 100;
  const lines = (await readFile(state.logFile, "utf8"))
    .split(/\r?\n/)
    .slice(-count);
  process.stdout.write(`${lines.join("\n")}\n`);
}

async function inspectDatabase(options) {
  const state = await readState(requireOption(options, "run"));
  const databasePath = path.join(state.profileDir, "streamfusion.db");
  if (!existsSync(databasePath)) {
    throw new Error(`Verification database does not exist: ${databasePath}`);
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  let quickCheck;
  let userVersion;
  let tables;
  let rowCounts;
  try {
    quickCheck = database
      .prepare("PRAGMA quick_check")
      .all()
      .map((row) => row.quick_check);
    userVersion = database.prepare("PRAGMA user_version").get().user_version;
    tables = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all()
      .map((row) => row.name);
    rowCounts = Object.fromEntries(
      requiredDatabaseTables
        .filter((table) => tables.includes(table))
        .map((table) => [
          table,
          database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()
            .count,
        ]),
    );
  } finally {
    database.close();
  }

  const missingTables = requiredDatabaseTables.filter(
    (table) => !tables.includes(table),
  );
  const result = {
    healthy:
      quickCheck.length === 1 &&
      quickCheck[0] === "ok" &&
      missingTables.length === 0,
    databasePath,
    seededFrom: state.databaseSeed?.source ?? null,
    quickCheck,
    userVersion,
    requiredTables: requiredDatabaseTables,
    missingTables,
    rowCounts,
  };
  const output = safeEvidencePath(state, options.output, ".database.json");
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  json({ ...result, output });
  if (!result.healthy) process.exitCode = 1;
}

async function stopProcessTree(pid) {
  if (!pid || !isProcessAlive(pid)) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      stdio: "ignore",
    });
  } else {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      process.kill(pid, "SIGTERM");
    }
  }
}

async function removeRunScratch(state) {
  const runDir = safeRunDirectory(state.runDir);
  await rm(runDir, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  });
  return runDir;
}

async function cleanup(options) {
  const state = await readCleanupState(requireOption(options, "run"));
  await mkdir(state.evidenceDir, { recursive: true });
  await writeFile(
    path.join(state.evidenceDir, "cleanup-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
  await stopProcessTree(state.pid);
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      await getTargets(state.port);
      await new Promise((resolve) => setTimeout(resolve, 200));
    } catch {
      break;
    }
  }
  const runDir = await removeRunScratch(state);
  return {
    cleaned: true,
    runDir,
    evidenceDir: state.evidenceDir,
    evidenceExists: existsSync(state.evidenceDir),
  };
}

function usage() {
  return `StreamFusion verification controller

Commands:
  launch [--mode dev:electron|preview] [--id ID] [--port PORT] [--database PATH] [--storage PATH] [-- ELECTRON_ARGS]
  session --mode preview [--id ID] [--port PORT] [--database PATH] [--storage PATH] [-- ELECTRON_ARGS]
  doctor --run RUN_JSON
  database --run RUN_JSON [--output RELATIVE_PATH]
  click --run RUN_JSON --role ROLE --name NAME
  fill --run RUN_JSON --role ROLE --name NAME --value VALUE
  press --run RUN_JSON --role ROLE --name NAME --key KEY
  element --run RUN_JSON --role ROLE --name NAME
  wait --run RUN_JSON [--text TEXT] [--hash HASH] [--timeout MS]
  snapshot --run RUN_JSON [--output RELATIVE_PATH]
  screenshot --run RUN_JSON [--output RELATIVE_PATH]
  evaluate --run RUN_JSON --expression JAVASCRIPT
  logs --run RUN_JSON [--lines COUNT]
  cleanup --run RUN_JSON
`;
}

async function main() {
  const { command, options, electronArgs } = parseArguments(
    process.argv.slice(2),
  );
  if (!command || command === "help" || command === "--help") {
    process.stdout.write(usage());
    return;
  }
  if (command === "launch") {
    const launched = await launch(options, electronArgs);
    json(launched.report);
    return;
  }
  if (command === "session") {
    const result = await runManagedVerificationSession(
      { options, electronArgs },
      {
        launch: async ({
          options: launchOptions,
          electronArgs: launchArgs,
        }) => {
          const launched = await launch(launchOptions, launchArgs, {
            managed: true,
          });
          json(launched.report);
          return launched;
        },
        cleanup: async (state) => {
          json(await cleanup({ run: state.runFile }));
        },
      },
    );
    process.exitCode = result.code;
    return;
  }
  if (command === "doctor") return doctor(options);
  if (command === "database") return inspectDatabase(options);
  if (["click", "fill", "press"].includes(command))
    return interact(command, options);
  if (command === "element") return inspectElement(options);
  if (command === "wait") return wait(options);
  if (command === "snapshot") return snapshot(options);
  if (command === "screenshot") return screenshot(options);
  if (command === "evaluate") return rawEvaluate(options);
  if (command === "logs") return logs(options);
  if (command === "cleanup") return json(await cleanup(options));
  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : String(error)}\n`,
  );
  process.exitCode = 1;
});
