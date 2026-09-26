import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer as createHttpServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import { build, createServer } from "vite";
import { resolveConfig } from "electron-vite";
import {
  createDevelopmentCleanup,
  observePreloadBuilds,
  retireViteProxyUpgrades,
} from "./start-start-lib.mjs";

const require = createRequire(import.meta.url);
const { createStartEnvironment } = require("./start-dev-lib.js");
const { createDevelopmentRun, createElectronViteArguments } = require("./start-dev-run-lib.js");
const { prepareBrandedElectronExecutable } = require("./prepare-dev-electron-lib.js");
const desktop = resolve(import.meta.dirname, "..");
const cleanup = createDevelopmentCleanup();
const controller = new AbortController();
const { signal } = controller;
let signalExitCode;
let child;

function interrupt(name) {
  signalExitCode ??= name === "SIGINT" ? 130 : 143;
  controller.abort(new Error(`Start development interrupted by ${name}`));
}
const onInterrupt = () => interrupt("SIGINT");
const onTerminate = () => interrupt("SIGTERM");
process.on("SIGINT", onInterrupt);
process.on("SIGTERM", onTerminate);

function childIsRunning() {
  return child?.pid && child.exitCode === null && child.signalCode === null;
}

async function stopChild() {
  if (!childIsRunning()) return;
  const exited = once(child, "exit");
  let timeout;
  try {
    if (process.platform === "win32") {
      const killer = spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      const [code] = await once(killer, "exit");
      if (code !== 0 && childIsRunning())
        throw new Error(`Could not stop owned launcher ${child.pid}`);
    } else {
      try {
        process.kill(-child.pid, "SIGTERM");
      } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
    await Promise.race([
      exited,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Owned Electron launcher did not exit")),
          10_000
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

try {
  const env = await createStartEnvironment(process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(process.env, env);
  signal.throwIfAborted();
  const httpServer = createHttpServer();
  const connections = new Set();
  httpServer.on("connection", (socket) => {
    connections.add(socket);
    socket.once("close", () => connections.delete(socket));
  });
  cleanup.add(async () => {
    const closed = new Promise((resolveClosed, reject) => {
      httpServer.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
        else resolveClosed();
      });
    });
    for (const socket of connections) socket.destroy();
    await closed;
  });
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  signal.throwIfAborted();
  const address = httpServer.address();
  if (!address || typeof address === "string")
    throw new Error("Start did not expose a local development port");
  const url = `http://127.0.0.1:${address.port}/`;
  // Own shutdown instead of Vite's process-exit hooks; verifier stdin is intentionally closed.
  const server = await createServer({
    root: desktop,
    configFile: resolve(desktop, "start.vite.config.mts"),
    plugins: [retireViteProxyUpgrades(httpServer)],
    server: {
      middlewareMode: { server: httpServer },
      port: address.port,
      hmr: { server: httpServer, clientPort: address.port },
    },
  });
  cleanup.add(() => server.close());
  httpServer.on("request", server.middlewares);
  signal.throwIfAborted();
  env.ELECTRON_RENDERER_URL = url;
  env.STREAMFUSION_DEV_ICON_PATH = resolve(desktop, "assets/icons/icon.ico");
  env.ELECTRON_EXEC_PATH = await prepareBrandedElectronExecutable({
    electronPath: require("electron"),
    electronVersion: require("electron/package.json").version,
    iconPath: env.STREAMFUSION_DEV_ICON_PATH,
  });
  signal.throwIfAborted();
  const run = await createDevelopmentRun(desktop);
  cleanup.add(async () => {
    if (childIsRunning())
      throw new Error("Retaining development output while its launcher is alive");
    await run.cleanup();
  });
  signal.throwIfAborted();
  const preloadDir = resolve(run.outDir, "preload");
  await mkdir(preloadDir, { recursive: true });
  process.env.STREAMFUSION_START_PRELOAD_DIR = preloadDir;
  const slotConfig = await resolveConfig(
    { configFile: resolve(desktop, "slot.preload.config.ts") },
    "build",
    "development"
  );
  signal.throwIfAborted();
  const slotWatcher = await build({
    ...slotConfig.config.preload,
    build: { ...slotConfig.config.preload.build, watch: {} },
  });
  cleanup.add(() => slotWatcher.close());
  const reload = () => {
    if (!signal.aborted) server.ws.send({ type: "full-reload" });
  };
  const builds = observePreloadBuilds(slotWatcher, {
    reload,
    reportError: (error) => console.error("Slot preload rebuild failed:", error),
    signal,
  });
  cleanup.add(() => builds.dispose());
  await builds.firstBuild;
  signal.throwIfAborted();
  const cli = resolve(
    dirname(require.resolve("electron-vite/package.json")),
    "bin/electron-vite.js"
  );
  child = spawn(
    process.execPath,
    [
      cli,
      ...createElectronViteArguments(
        ["--config", "start.electron.config.ts", "--watch", ...process.argv.slice(2)],
        run
      ),
    ],
    {
      cwd: desktop,
      env,
      stdio: ["inherit", "inherit", "inherit", "ipc"],
      windowsHide: true,
      detached: process.platform !== "win32",
    }
  );
  cleanup.add(stopChild);
  child.on("message", (message) => {
    if (message?.type === "streamfusion-preload-rebuilt") reload();
  });
  console.log(`Start desktop renderer: ${url}`);
  if (env.STREAMFUSION_BROWSER_DEV === "1") console.log(`Browser relay: ${url}browser.html`);
  const [code, exitSignal] = await once(child, "close", { signal });
  process.exitCode = code ?? (exitSignal === "SIGINT" ? 130 : 1);
} catch (error) {
  if (!signal.aborted) console.error(error);
  process.exitCode = signalExitCode ?? 1;
} finally {
  try {
    await cleanup.close();
  } catch (error) {
    console.error(error);
    process.exitCode = signalExitCode ?? 1;
  }
  process.off("SIGINT", onInterrupt);
  process.off("SIGTERM", onTerminate);
}
