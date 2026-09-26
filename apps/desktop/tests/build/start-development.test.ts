import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  createDevelopmentCleanup,
  observePreloadBuilds,
  retireViteProxyUpgrades,
} from "../../scripts/start-start-lib.mjs";

// Guards: preload compilation failures retain the current renderer; only completed rebuilds reload it.
// Guards: interrupted startup and failed cleanup cannot leak other owned resources or run cleanup twice.
// Guards: retiring a Vite generation removes its proxy without removing replacement or HMR listeners.
describe("Start development lifecycle", () => {
  it("retires only the old proxy when its replacement is installed before the old server closes", async () => {
    const httpServer = new EventEmitter();
    const oldHmr = vi.fn();
    const oldProxy = vi.fn();
    const newHmr = vi.fn();
    const newProxy = vi.fn();
    httpServer.on("upgrade", oldHmr);
    const plugin = retireViteProxyUpgrades(httpServer);
    const closeOld = vi.fn(async () => undefined);
    const oldServer = { close: closeOld };
    const afterOldMiddleware = plugin.configureServer(oldServer);
    httpServer.on("upgrade", oldProxy);
    afterOldMiddleware();

    httpServer.on("upgrade", newHmr);
    const closeNew = vi.fn(async () => undefined);
    const newServer = { close: closeNew };
    const afterNewMiddleware = plugin.configureServer(newServer);
    httpServer.on("upgrade", newProxy);
    afterNewMiddleware();

    await oldServer.close();
    await oldServer.close();
    httpServer.emit("upgrade");
    expect(oldProxy).not.toHaveBeenCalled();
    expect(newProxy).toHaveBeenCalledTimes(1);
    expect(oldHmr).toHaveBeenCalledTimes(1);
    expect(newHmr).toHaveBeenCalledTimes(1);
    expect(closeOld).toHaveBeenCalled();

    await newServer.close();
    expect(httpServer.listeners("upgrade")).toEqual([oldHmr, newHmr]);
    expect(closeNew).toHaveBeenCalledTimes(1);
  });

  it("removes a generation's proxy even when the underlying server close fails", async () => {
    const httpServer = new EventEmitter();
    const server = {
      close: async () => {
        throw new Error("Watcher shutdown failed");
      },
    };
    const afterMiddleware = retireViteProxyUpgrades(httpServer).configureServer(server);
    httpServer.on("upgrade", vi.fn());
    afterMiddleware();
    await expect(server.close()).rejects.toThrow("Watcher shutdown failed");
    expect(httpServer.listenerCount("upgrade")).toBe(0);
  });

  it("waits for a successful initial build and reloads only successful subsequent builds", async () => {
    const watcher = new EventEmitter();
    const reload = vi.fn();
    const reportError = vi.fn();
    const controller = new AbortController();
    const builds = observePreloadBuilds(watcher, {
      reload,
      reportError,
      signal: controller.signal,
    });
    watcher.emit("event", { code: "START" });
    watcher.emit("event", { code: "BUNDLE_END" });
    expect(reload).not.toHaveBeenCalled();
    watcher.emit("event", { code: "END" });
    await builds.firstBuild;
    expect(reload).not.toHaveBeenCalled();

    const error = new Error("Invalid preload source");
    watcher.emit("event", { code: "START" });
    watcher.emit("event", { code: "ERROR", error });
    watcher.emit("event", { code: "END" });
    expect(reportError).toHaveBeenCalledWith(error);
    expect(reload).not.toHaveBeenCalled();

    watcher.emit("event", { code: "START" });
    watcher.emit("event", { code: "END" });
    expect(reload).toHaveBeenCalledTimes(1);
    controller.abort();
    watcher.emit("event", { code: "START" });
    watcher.emit("event", { code: "END" });
    expect(reload).toHaveBeenCalledTimes(1);
    builds.dispose();
    expect(watcher.listenerCount("event")).toBe(0);
  });

  it("rejects failed initial compilation instead of launching without a slot preload", async () => {
    const watcher = new EventEmitter();
    const builds = observePreloadBuilds(watcher, {
      reload: vi.fn(),
      reportError: vi.fn(),
      signal: new AbortController().signal,
    });
    const failure = new Error("Missing preload import");
    watcher.emit("event", { code: "ERROR", error: failure });
    await expect(builds.firstBuild).rejects.toBe(failure);
    builds.dispose();
  });

  it("interrupts startup while the initial preload build is pending", async () => {
    const watcher = new EventEmitter();
    const controller = new AbortController();
    const builds = observePreloadBuilds(watcher, {
      reload: vi.fn(),
      reportError: vi.fn(),
      signal: controller.signal,
    });
    const reason = new Error("Stopped by user");
    controller.abort(reason);
    await expect(builds.firstBuild).rejects.toBe(reason);
    builds.dispose();
    expect(watcher.listenerCount("event")).toBe(0);
  });

  it("closes every acquired resource once in reverse order even when cleanup fails", async () => {
    const cleanup = createDevelopmentCleanup();
    const closed: string[] = [];
    cleanup.add(async () => closed.push("server"));
    cleanup.add(async () => {
      closed.push("run");
      throw new Error("Locked output");
    });
    cleanup.add(async () => closed.push("watcher"));
    cleanup.add(async () => closed.push("child"));
    const first = cleanup.close();
    expect(cleanup.close()).toBe(first);
    await expect(first).rejects.toMatchObject({
      errors: [expect.objectContaining({ message: "Locked output" })],
    });
    expect(closed).toEqual(["child", "watcher", "run", "server"]);
  });
});
