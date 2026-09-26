import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const requiredTables = [
  "key_value",
  "local_follows",
  "mod_log",
  "mod_log_coverage",
  "pending_follow_writes",
  "retention_settings",
];
const checkNames = [
  "preconditions",
  "artifact",
  "ffmpeg",
  "launch",
  "shell",
  "settings",
  "quit",
  "database",
  "logs",
  "cleanup",
];

export function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    assert(["--app", "--arch", "--evidence"].includes(key), `Unknown option: ${key}`);
    assert(argv[index + 1] && !argv[index + 1].startsWith("--"), `Missing value: ${key}`);
    assert(options[key] === undefined, `Duplicate option: ${key}`);
    options[key] = argv[index + 1];
  }
  assert(
    options["--app"] && options["--evidence"],
    "Provide --app <package.app> --arch <x64|arm64> --evidence <new directory>"
  );
  assert(["x64", "arm64"].includes(options["--arch"]), "Architecture must be x64 or arm64");
  return {
    app: path.resolve(options["--app"]),
    arch: options["--arch"],
    evidence: path.resolve(options["--evidence"]),
  };
}

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    encoding: "utf8",
    timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `${path.basename(file)} failed (${result.status}): ${result.stderr || result.stdout}`
  );
  return result.stdout.trim();
}

async function sha256(file) {
  return createHash("sha256")
    .update(await readFile(file))
    .digest("hex");
}

// System Events uses native accessibility, not an injected renderer or debugging port.
const accessibilityScript = String.raw`
on attributeText(elementRef, attributeName)
  tell application "System Events"
    try
      set attributeValue to value of attribute attributeName of elementRef
      if attributeValue is missing value then return ""
      set attributeValue to attributeValue as text
      set savedDelimiters to AppleScript's text item delimiters
      set AppleScript's text item delimiters to {tab, return, linefeed}
      set parts to text items of attributeValue
      set AppleScript's text item delimiters to " "
      set attributeValue to parts as text
      set AppleScript's text item delimiters to savedDelimiters
      return attributeValue
    on error
      return ""
    end try
  end tell
end attributeText

on rowText(roleText, nameText, descriptionText, valueText, placeholderText)
  return roleText & tab & nameText & tab & descriptionText & tab & valueText & tab & placeholderText
end rowText

on labelRow(elementRef, roleText, targetLabel, attributeNames)
  set nameText to ""
  set descriptionText to ""
  set valueText to ""
  set placeholderText to ""
  repeat with attributeNameRef in attributeNames
    set attributeName to attributeNameRef as text
    set attributeValue to my attributeText(elementRef, attributeName)
    if attributeName is "AXTitle" then
      set nameText to attributeValue
    else if attributeName is "AXDescription" then
      set descriptionText to attributeValue
    else if attributeName is "AXValue" then
      set valueText to attributeValue
    else if attributeName is "AXPlaceholderValue" then
      set placeholderText to attributeValue
    end if
    if attributeValue contains targetLabel then
      return my rowText(roleText, nameText, descriptionText, valueText, placeholderText)
    end if
  end repeat
  return ""
end labelRow

on run argv
  set ownedPid to item 1 of argv as integer
  set requestedAction to item 2 of argv
  tell application "System Events"
    if not (exists (first application process whose unix id is ownedPid)) then error "Owned process is not accessible"
    set ownedProcess to first application process whose unix id is ownedPid
    set frontmost of ownedProcess to true
    if (count of windows of ownedProcess) is 0 then error "Owned application has no window"
    set ownedWindow to first window of ownedProcess
    set windowRow to my rowText("AXWindow", my attributeText(ownedWindow, "AXTitle"), "", "", "")
    if requestedAction is "probe" then
      set accessibilityEnabled to UI elements enabled
      set size of ownedWindow to {1024, 768}
      repeat 40 times
        set actualSize to size of ownedWindow
        if item 1 of actualSize is 1024 then exit repeat
        delay 0.05
      end repeat
      set sizeText to (item 1 of actualSize as text) & "x" & (item 2 of actualSize as text)
      return my rowText("AXProbe", "System Events", "", accessibilityEnabled as text, "") & linefeed & windowRow & linefeed & my rowText("AXWindowSize", "", "", sizeText, "")
    end if

    set pendingElements to {ownedWindow}
    set pendingDepths to {0}
    set cursor to 1
    set visitedCount to 0
    set enqueuedCount to 1
    set maximumElements to 1500
    set maximumDepth to 32
    set webAreaRow to ""
    set settingsRow to ""
    set searchRow to ""
    set settingsDescriptionRow to ""

    repeat while cursor is less than or equal to (count of pendingElements)
      if visitedCount is greater than or equal to maximumElements then error "Accessibility traversal exceeded 1500 elements"
      set elementRef to item cursor of pendingElements
      set elementDepth to item cursor of pendingDepths as integer
      set cursor to cursor + 1
      set visitedCount to visitedCount + 1
      set roleText to my attributeText(elementRef, "AXRole")

      if requestedAction is "shellSnapshot" then
        if webAreaRow is "" and roleText is "AXWebArea" then
          set webAreaRow to my rowText(roleText, my attributeText(elementRef, "AXTitle"), "", "", "")
        else if settingsRow is "" and (roleText is "AXLink" or roleText is "AXButton") then
          set settingsRow to my labelRow(elementRef, roleText, "Settings", {"AXTitle", "AXDescription", "AXValue"})
        else if searchRow is "" and (roleText is "AXTextField" or roleText is "AXTextArea") then
          set searchRow to my labelRow(elementRef, roleText, "Search Twitch and Kick", {"AXPlaceholderValue", "AXTitle", "AXDescription", "AXValue"})
        end if
        if webAreaRow is not "" and settingsRow is not "" and searchRow is not "" then
          return windowRow & linefeed & webAreaRow & linefeed & settingsRow & linefeed & searchRow
        end if
      else if requestedAction is "settings" then
        if roleText is "AXLink" or roleText is "AXButton" then
          set settingsRow to my labelRow(elementRef, roleText, "Settings", {"AXTitle", "AXDescription", "AXValue"})
          if settingsRow is not "" then
            perform action "AXPress" of elementRef
            return "Settings pressed"
          end if
        end if
      else if requestedAction is "settingsSnapshot" then
        if settingsDescriptionRow is "" and (roleText is "AXStaticText" or roleText is "AXHeading") then
          set settingsDescriptionRow to my labelRow(elementRef, roleText, "Personalize your StreamFusion experience", {"AXValue", "AXTitle", "AXDescription"})
        else if searchRow is "" and (roleText is "AXTextField" or roleText is "AXTextArea") then
          set searchRow to my labelRow(elementRef, roleText, "Search settings", {"AXPlaceholderValue", "AXTitle", "AXDescription", "AXValue"})
        end if
        if settingsDescriptionRow is not "" and searchRow is not "" then
          return windowRow & linefeed & settingsDescriptionRow & linefeed & searchRow
        end if
      else
        error "Unknown accessibility action: " & requestedAction
      end if

      if elementDepth is less than maximumDepth then
        try
          set childElements to UI elements of elementRef
          if enqueuedCount is less than maximumElements then
            repeat with childElement in childElements
              if enqueuedCount is greater than or equal to maximumElements then exit repeat
              set end of pendingElements to contents of childElement
              set end of pendingDepths to elementDepth + 1
              set enqueuedCount to enqueuedCount + 1
            end repeat
          end if
        end try
      end if
    end repeat
    if requestedAction is "shellSnapshot" then
      set outputRows to windowRow
      if webAreaRow is not "" then set outputRows to outputRows & linefeed & webAreaRow
      if settingsRow is not "" then set outputRows to outputRows & linefeed & settingsRow
      if searchRow is not "" then set outputRows to outputRows & linefeed & searchRow
      return outputRows
    else if requestedAction is "settingsSnapshot" then
      set outputRows to windowRow
      if settingsDescriptionRow is not "" then set outputRows to outputRows & linefeed & settingsDescriptionRow
      if searchRow is not "" then set outputRows to outputRows & linefeed & searchRow
      return outputRows
    end if
    error "Required accessibility target not found after " & visitedCount & " elements for " & requestedAction
  end tell
end run
`;

const quitScript = String.raw`
ObjC.import('AppKit');
function run(argv) {
  const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(Number(argv[0]));
  if (!app || ObjC.unwrap(app.executableURL.path) !== argv[1]) throw new Error('Owned application identity changed');
  if (!app.terminate) throw new Error('Normal application quit request was rejected');
  return 'quit requested';
}
`;

export function parseAccessibilitySnapshot(text) {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [role, name = "", description = "", value = "", placeholder = ""] = line.split("\t");
      return { role, name, description, value, placeholder };
    });
}

function hasLabel(rows, label) {
  return rows.some((row) =>
    [row.name, row.description, row.value, row.placeholder].some((text) => text.includes(label))
  );
}

function processIdentity(pid) {
  const start = command("/bin/ps", ["-p", String(pid), "-o", "lstart="]);
  const invocation = command("/bin/ps", ["-ww", "-p", String(pid), "-o", "command="]);
  return { pid, start, invocation };
}

function processGroupMembers(processGroupId) {
  const result = spawnSync("/bin/ps", ["-o", "pid=", "-g", String(processGroupId)], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  assert(
    result.status === 0 || result.status === 1,
    `ps failed (${result.status}): ${result.stderr || result.stdout}`
  );
  return result.stdout
    .split(/\s+/)
    .filter(Boolean)
    .map((value) => Number(value));
}

export async function verifyPackage(options) {
  await mkdir(options.evidence, { recursive: true });
  assert.equal(
    (await readdir(options.evidence)).length,
    0,
    "Evidence directory must be empty; previous evidence is never overwritten"
  );
  const report = {
    startedAt: new Date().toISOString(),
    platform: process.platform,
    architecture: process.arch,
    requestedArchitecture: options.arch,
    app: options.app,
    passed: false,
    checks: Object.fromEntries(checkNames.map((name) => [name, { status: "not_run" }])),
    limitations: [
      "Unsigned package: no Gatekeeper, notarization, installer or updater claim",
      "Native shell and Settings checks use a 1024-pixel-wide window with height constrained by macOS; wider layouts and live chat load require separate evidence",
      "Signed-out startup and Settings only; provider, playback and isolated-player runtime parity remain separate gates",
    ],
  };
  let activeCheck;
  let runDir;
  let child;
  let identity;
  let profile;
  let executable;
  let stdoutFd;
  let stderrFd;
  let launchFailure;
  let launchedAt;
  let interruption;
  const onSignal = (signal) => {
    interruption ??= new Error(`Verification interrupted by ${signal}`);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);
  const throwIfInterrupted = () => {
    if (interruption) throw interruption;
  };
  const check = async (name, action) => {
    activeCheck = name;
    throwIfInterrupted();
    const evidence = await action();
    report.checks[name] = { status: "passed", evidence };
  };
  const running = () => child?.pid && child.exitCode === null && child.signalCode === null;
  const requireOwned = () => {
    if (launchFailure) throw launchFailure;
    assert(running(), "Packaged application exited before verification completed");
    assert.deepEqual(
      processIdentity(child.pid),
      identity,
      "Refusing to operate on a changed process identity"
    );
  };
  const ui = (action, timeout = 30_000) => {
    throwIfInterrupted();
    requireOwned();
    return command("/usr/bin/osascript", ["-", String(child.pid), action], {
      input: accessibilityScript,
      timeout,
    });
  };
  const waitForUi = async (action, predicate, filename, deadline = Date.now() + 90_000) => {
    let rows = [];
    let lastError;
    while (Date.now() < deadline) {
      throwIfInterrupted();
      requireOwned();
      try {
        rows = parseAccessibilitySnapshot(ui(action));
        if (predicate(rows)) {
          await writeFile(path.join(options.evidence, filename), JSON.stringify(rows, null, 2));
          return rows;
        }
      } catch (error) {
        lastError = error;
        if (
          /not allowed|not authorized|assistive access|privilege|authorization/i.test(error.message)
        )
          throw error;
      }
      await delay(500);
    }
    await writeFile(path.join(options.evidence, filename), JSON.stringify(rows, null, 2));
    throw new Error(
      `Required native UI did not appear${lastError ? `: ${lastError.message}` : ""}`
    );
  };
  const screenshot = async (filename) => {
    requireOwned();
    const output = path.join(options.evidence, filename);
    command("/usr/sbin/screencapture", ["-x", output]);
    assert((await stat(output)).size > 0, "Native screenshot is empty");
    return filename;
  };
  const waitForExit = async (milliseconds, cleaningUp = false) => {
    const deadline = Date.now() + milliseconds;
    while (running() && Date.now() < deadline) {
      if (!cleaningUp) throwIfInterrupted();
      await delay(100);
    }
    return !running();
  };
  const collectLogs = async () => {
    assert(launchedAt !== undefined, "Application was not launched");
    const logsRoot = path.join(homedir(), "Library/Logs/StreamFusion");
    const pointer = path.join(logsRoot, "streamfusion-current.log.path");
    assert(
      (await stat(pointer)).mtimeMs >= launchedAt,
      "No session log was created by this launch"
    );
    const log = await realpath((await readFile(pointer, "utf8")).trim());
    assert(
      path.dirname(log) === (await realpath(logsRoot)) &&
        (await stat(log)).birthtimeMs >= launchedAt,
      "Session log belongs to a different launch"
    );
    await copyFile(log, path.join(options.evidence, "application.log"));
    const text = await readFile(log, "utf8");
    const fatalLines = text
      .split(/\r?\n/)
      .filter((line) =>
        /Minified React error #418|hydration mismatch|A tree hydrated but|Unable to load preload|ERR_FILE_NOT_FOUND|Refused to .*Content Security Policy|Cannot find module|NODE_MODULE_VERSION|renderer.*(?:crashed|killed)|SQLITE_CORRUPT|SQLITE_NOTADB/i.test(
          line
        )
      );
    assert.deepEqual(fatalLines, [], `Runtime errors in application log: ${fatalLines.join("\n")}`);
    return { source: log, evidence: "application.log" };
  };
  try {
    await check("preconditions", async () => {
      assert.equal(process.platform, "darwin", "This proof requires a native macOS runner");
      assert.equal(process.arch, options.arch, "Runner architecture must match the candidate");
      const existing = spawnSync("/usr/bin/pgrep", ["-x", "StreamFusion"], { encoding: "utf8" });
      assert.equal(
        existing.status,
        1,
        "Close existing StreamFusion instances before isolated proof"
      );
      assert(options.app.endsWith(".app"), "Provide the actual .app package path");
      return {
        sourceRevision: command("git", ["rev-parse", "HEAD"], { cwd: repoRoot }),
        lockfileSha256: await sha256(path.join(repoRoot, "package-lock.json")),
        os: command("/usr/bin/sw_vers", []),
        runnerImage: process.env.ImageVersion ?? null,
      };
    });
    await check("artifact", async () => {
      const sourceApp = await realpath(options.app);
      runDir = await mkdtemp(path.join(await realpath(tmpdir()), "streamfusion-macos-proof-"));
      assert(
        !runDir.startsWith(repoRoot + path.sep),
        "Runtime proof must be outside the workspace"
      );
      const copiedApp = path.join(runDir, "StreamFusion.app");
      command("/usr/bin/ditto", [sourceApp, copiedApp], { timeout: 90_000 });
      executable = path.join(copiedApp, "Contents/MacOS/StreamFusion");
      profile = path.join(runDir, "profile");
      await mkdir(profile);
      const archive = path.join(copiedApp, "Contents/Resources/app.asar");
      const sourceArchive = path.join(sourceApp, "Contents/Resources/app.asar");
      const architecture = command("/usr/bin/lipo", ["-archs", executable]);
      assert.equal(
        architecture,
        options.arch === "x64" ? "x86_64" : "arm64",
        "Package executable architecture mismatch"
      );
      assert.equal(
        await sha256(archive),
        await sha256(sourceArchive),
        "Runtime copy differs from packaged archive"
      );
      assert.equal(
        await sha256(executable),
        await sha256(path.join(sourceApp, "Contents/MacOS/StreamFusion")),
        "Runtime executable differs from package"
      );
      const { listPackage, extractFile } = createRequire(import.meta.url)("@electron/asar");
      const entries = listPackage(archive).map((entry) =>
        entry.replaceAll("\\", "/").replace(/^\//, "")
      );
      for (const required of [
        "out/main/index.js",
        "out/preload/index.js",
        "out/preload/slot.js",
        "out/renderer/index.html",
        "out/renderer/src/frontend/slot-renderer/index.html",
      ])
        assert(entries.includes(required), `Packaged file missing: ${required}`);
      assert(
        !entries.some((entry) =>
          /^node_modules\/@tanstack\/(?:react-start|start-server|start-plugin)/.test(entry)
        ),
        "Start server tooling must not ship"
      );
      const metadata = JSON.parse(extractFile(archive, "package.json").toString());
      const sqliteBinding = path.join(
        copiedApp,
        `Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/prebuilds/darwin-${options.arch}.node`
      );
      assert((await stat(sqliteBinding)).isFile(), "Packaged native SQLite binding is missing");
      return {
        sourceApp,
        copiedApp,
        version: metadata.version,
        architecture,
        appAsarSha256: await sha256(archive),
        executableSha256: await sha256(executable),
        sqliteBindingSha256: await sha256(sqliteBinding),
      };
    });
    await check("ffmpeg", async () => {
      const file = path.join(
        runDir,
        "StreamFusion.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg"
      );
      const output = command(file, ["-version"], { cwd: runDir });
      assert(output.startsWith("ffmpeg version"), "Packaged FFmpeg did not report its version");
      await writeFile(path.join(options.evidence, "ffmpeg.txt"), output);
      return { sha256: await sha256(file), output: "ffmpeg.txt" };
    });
    await check("launch", async () => {
      stdoutFd = openSync(path.join(options.evidence, "stdout.txt"), "wx");
      stderrFd = openSync(path.join(options.evidence, "stderr.txt"), "wx");
      const env = { ...process.env };
      for (const name of [
        "ELECTRON_RUN_AS_NODE",
        "NODE_PATH",
        "NODE_OPTIONS",
        "ELECTRON_RENDERER_URL",
        "STREAMFUSION_BROWSER_DEV",
        "STREAMFUSION_DEV_USER_DATA_DIR",
      ])
        delete env[name];
      launchedAt = Date.now();
      child = spawn(executable, [`--user-data-dir=${profile}`, "--force-renderer-accessibility"], {
        cwd: runDir,
        env,
        detached: true,
        stdio: ["ignore", stdoutFd, stderrFd],
      });
      child.once("error", (error) => {
        launchFailure = error;
      });
      await delay(100);
      assert(
        running() && !launchFailure,
        launchFailure?.message ?? "Packaged application failed to start"
      );
      identity = processIdentity(child.pid);
      assert(
        identity.invocation.startsWith(executable + " ") &&
          identity.invocation.includes(`--user-data-dir=${profile}`),
        "Launched process path/profile identity mismatch"
      );
      return { ...identity, profile, command: executable };
    });
    await check("shell", async () => {
      const deadline = Date.now() + 90_000;
      const probeStartedAt = Date.now();
      const probeAttempts = [];
      let probeRows = [];
      let probeStatus = "running";
      let probeError;
      try {
        let lastError;
        while (Date.now() < deadline) {
          const attemptStartedAt = Date.now();
          try {
            const rows = parseAccessibilitySnapshot(ui("probe", 5_000));
            probeRows = rows;
            assert(
              rows.some((row) => row.role === "AXProbe" && row.value === "true"),
              "System Events accessibility probe did not report UI access"
            );
            assert(
              rows.some((row) => row.role === "AXWindow"),
              "System Events accessibility probe did not find the application window"
            );
            assert(
              rows.some((row) => row.role === "AXWindowSize" && /^1024x\d+$/.test(row.value)),
              `Native verification window did not reach width 1024: ${rows.find((row) => row.role === "AXWindowSize")?.value}`
            );
            probeAttempts.push({
              status: "passed",
              startedAt: new Date(attemptStartedAt).toISOString(),
              durationMs: Date.now() - attemptStartedAt,
            });
            probeStatus = "passed";
            break;
          } catch (error) {
            lastError = error;
            probeAttempts.push({
              status: "failed",
              startedAt: new Date(attemptStartedAt).toISOString(),
              durationMs: Date.now() - attemptStartedAt,
              error: error.message,
            });
            if (!/Owned application has no window/.test(error.message)) throw error;
            await delay(Math.min(500, Math.max(0, deadline - Date.now())));
          }
        }
        if (probeStatus !== "passed") {
          throw new Error(
            `Accessibility probe did not find the application window${lastError ? `: ${lastError.message}` : ""}`
          );
        }
      } catch (error) {
        probeStatus = "failed";
        probeError = error.message;
        throw error;
      } finally {
        await writeFile(
          path.join(options.evidence, "accessibility-probe.json"),
          JSON.stringify(
            {
              status: probeStatus,
              startedAt: new Date(probeStartedAt).toISOString(),
              durationMs: Date.now() - probeStartedAt,
              attempts: probeAttempts,
              ...(probeRows.length > 0 ? { rows: probeRows } : {}),
              ...(probeError ? { error: probeError } : {}),
            },
            null,
            2
          )
        );
      }
      await waitForUi(
        "shellSnapshot",
        (rows) =>
          rows.some((row) => row.role === "AXWebArea") &&
          hasLabel(rows, "Settings") &&
          hasLabel(rows, "Search Twitch and Kick"),
        "shell-accessibility.json",
        deadline
      );
      return {
        probe: "accessibility-probe.json",
        snapshot: "shell-accessibility.json",
        screenshot: await screenshot("shell.png"),
      };
    });
    await check("settings", async () => {
      const action = ui("settings");
      assert.equal(action, "Settings pressed");
      await writeFile(
        path.join(options.evidence, "actions.json"),
        JSON.stringify(
          [{ at: new Date().toISOString(), pid: child.pid, action: "AXPress", name: "Settings" }],
          null,
          2
        )
      );
      await waitForUi(
        "settingsSnapshot",
        (rows) =>
          hasLabel(rows, "Personalize your StreamFusion experience") &&
          hasLabel(rows, "Search settings"),
        "settings-accessibility.json"
      );
      return {
        snapshot: "settings-accessibility.json",
        screenshot: await screenshot("settings.png"),
      };
    });
    await check("quit", async () => {
      requireOwned();
      command("/usr/bin/osascript", ["-l", "JavaScript", "-", String(child.pid), executable], {
        input: quitScript,
      });
      assert(await waitForExit(20_000), "Normal application quit did not complete");
      assert.equal(child.exitCode, 0, "Application did not exit cleanly");
      return { exitCode: child.exitCode };
    });
    await check("database", async () => {
      const { DatabaseSync } = await import("node:sqlite");
      const database = new DatabaseSync(path.join(profile, "streamfusion.db"), { readOnly: true });
      try {
        const quickCheck = database
          .prepare("PRAGMA quick_check")
          .all()
          .map((row) => row.quick_check);
        const tables = database
          .prepare("SELECT name FROM sqlite_master WHERE type='table'")
          .all()
          .map((row) => row.name);
        assert.deepEqual(quickCheck, ["ok"]);
        assert(
          requiredTables.every((table) => tables.includes(table)),
          "Application did not create required database tables"
        );
        return {
          quickCheck,
          tables,
          schemaVersion: database.prepare("PRAGMA user_version").get().user_version,
        };
      } finally {
        database.close();
      }
    });
    await check("logs", collectLogs);
  } catch (error) {
    const failedCheck = activeCheck ?? "preconditions";
    const failure = { status: "failed", error: error.message };
    if (running()) {
      try {
        failure.screenshot = await screenshot("failure.png");
      } catch (screenshotError) {
        failure.screenshotError = screenshotError.message;
      }
    }
    report.checks[failedCheck] = failure;
  } finally {
    try {
      if (launchedAt !== undefined && report.checks.logs.status === "not_run") {
        try {
          report.checks.logs = { status: "passed", evidence: await collectLogs() };
        } catch (error) {
          report.checks.logs = { status: "failed", error: error.message };
        }
      }
      for (const fd of [stdoutFd, stderrFd]) if (fd !== undefined) closeSync(fd);
      if (running()) {
        requireOwned();
        process.kill(-child.pid, "SIGTERM");
        if (!(await waitForExit(3000, true))) {
          requireOwned();
          process.kill(-child.pid, "SIGKILL");
          assert(await waitForExit(3000, true), "Owned application did not terminate");
        }
      }
      if (child?.pid) {
        const remaining = processGroupMembers(child.pid);
        assert.deepEqual(
          remaining,
          [],
          `Owned process group still has running members: ${remaining.join(", ")}`
        );
      }
      if (runDir) {
        assert(
          path.dirname(runDir) === (await realpath(tmpdir())) &&
            path.basename(runDir).startsWith("streamfusion-macos-proof-"),
          "Refusing cleanup outside owned temporary directory"
        );
        await rm(runDir, { recursive: true, force: true });
      }
      report.checks.cleanup = { status: "passed" };
    } catch (error) {
      report.checks.cleanup = { status: "failed", error: error.message };
    }
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
    report.finishedAt = new Date().toISOString();
    report.passed = checkNames.every((name) => report.checks[name].status === "passed");
    const temporaryReport = path.join(options.evidence, "report.json.tmp");
    await writeFile(temporaryReport, JSON.stringify(report, null, 2));
    await rename(temporaryReport, path.join(options.evidence, "report.json"));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = await verifyPackage(options);
    console.log(
      JSON.stringify(
        { passed: report.passed, checks: report.checks, evidence: options.evidence },
        null,
        2
      )
    );
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
