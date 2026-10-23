import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "C:\\profile" },
}));
vi.mock("@backend/features/settings/data/preferences-repository", () => ({
  preferencesRepository: {
    getPreferences: () => ({
      language: "es",
      playback: { defaultQuality: "1080p" },
      playerControls: { showQuality: false },
      buffer: { maxBufferLengthSec: 42 },
      playbackAdvanced: { playerType: "site" },
      captions: { enabled: true },
      unrelatedSetting: "excluded",
    }),
  },
}));

import { WebView2ProtectedPlaybackHost } from "@backend/features/playback/adapters/windows/webview2-protected-playback-host";

function fakeChild() {
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { destroyed: false, write: vi.fn(), end: vi.fn() }),
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: { resume: vi.fn() },
    exitCode: null,
    killed: false,
    kill: vi.fn(),
  });
  return child;
}

function fakeWindow(): BrowserWindow {
  return Object.assign(new EventEmitter(), {
    getNativeWindowHandle: () => Buffer.alloc(8),
    webContents: { getZoomFactor: () => 1 },
    setFullScreen: vi.fn(),
    isFullScreen: () => false,
    isDestroyed: () => false,
    isVisible: () => true,
    isMinimized: () => false,
  }) as unknown as BrowserWindow;
}

describe("WebView2 protected player host", () => {
  const createSession = vi.fn(async () => ({
    baseUrl: "http://127.0.0.1:45678/s/" + "a".repeat(64),
    close: vi.fn(async () => {}),
  }));
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  beforeEach(() => {
    spawn.mockReset();
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
    expect(process.platform).toBe("win32");
  });
  afterEach(() => Object.defineProperty(process, "platform", originalPlatform));

  it("reports the unavailable platform without starting a helper", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
    const host = new WebView2ProtectedPlaybackHost(createSession);
    await expect(
      host.open({
        ownerKey: "7:player-1",
        ownerId: "player-1",
        channelSlug: "primevideo",
        muted: false,
        preferences: {},
        window: fakeWindow(),
        onState: vi.fn(),
      })
    ).resolves.toEqual({ kind: "unavailable", reason: "unsupported-platform" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("cancels a reopen that is waiting for the previous child to exit", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const host = new WebView2ProtectedPlaybackHost(createSession);
    const input = {
      ownerKey: "7:player-1",
      ownerId: "player-1",
      channelSlug: "primevideo",
      muted: false,
      preferences: {},
      window: fakeWindow(),
      onState: vi.fn(),
    };
    const first = host.open(input);
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.emit("data", '{"type":"ready"}\n');
    await expect(first).resolves.toEqual({ kind: "opened" });
    expect(spawn.mock.calls[0][0]).toBe(
      join(
        process.cwd(),
        ".cache",
        "native",
        "protected-player",
        "StreamFusion.ProtectedPlayer.exe"
      )
    );
    expect(spawn.mock.calls[0][1]).toEqual([
      "--channel",
      "primevideo",
      "--owner",
      "0",
      "--parent-pid",
      String(process.pid),
      "--user-data-dir",
      join("C:\\profile", "protected-player"),
      "--muted",
      "false",
    ]);
    expect(spawn.mock.calls[0][2]).toMatchObject({ windowsHide: true, shell: false });
    await expect(host.open(input)).resolves.toEqual({ kind: "opened" });
    expect(child.stdin.write).toHaveBeenCalledWith('{"type":"focus"}\n');

    host.close(input.ownerKey);
    const pending = host.open(input);
    host.close(input.ownerKey);
    child.emit("close");

    await expect(pending).resolves.toEqual({ kind: "unavailable", reason: "host-start-failed" });
    expect(spawn).toHaveBeenCalledTimes(1);
  });

  it("reports a missing WebView2 runtime without claiming playback", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const onState = vi.fn();
    const host = new WebView2ProtectedPlaybackHost(createSession);
    const opening = host.open({
      ownerKey: "7:player-2",
      ownerId: "player-2",
      channelSlug: "primevideo",
      muted: true,
      preferences: {},
      window: fakeWindow(),
      onState,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.emit("data", '{"type":"failed","message":"runtime-missing"}\n');
    await expect(opening).resolves.toEqual({ kind: "unavailable", reason: "runtime-missing" });
    expect(onState).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      ownerId: "player-2",
      reason: "runtime-missing",
    });
    child.emit("close");
  });

  it("shares one preparation for concurrent opens and cancels it on close", async () => {
    let finishSession!: (value: Awaited<ReturnType<typeof createSession>>) => void;
    const pendingSession = new Promise<Awaited<ReturnType<typeof createSession>>>((resolve) => {
      finishSession = resolve;
    });
    const prepare = vi.fn(() => pendingSession);
    const host = new WebView2ProtectedPlaybackHost(prepare);
    const input = {
      ownerKey: "7:player-3",
      ownerId: "player-3",
      channelSlug: "primevideo",
      muted: false,
      preferences: {},
      window: fakeWindow(),
      onState: vi.fn(),
    };
    const placement = host.present(input.ownerKey, {
      revision: 1,
      presentation: "docked",
      blockerEnabled: true,
      layout: { kind: "hidden" },
    });
    const first = host.open(input);
    const second = host.open(input);
    expect(prepare).toHaveBeenCalledOnce();
    const gateway = {
      baseUrl: "http://127.0.0.1:45678/s/" + "a".repeat(64),
      close: vi.fn(async () => {}),
    };
    host.close(input.ownerKey);
    await placement;
    finishSession(gateway);
    await expect(first).resolves.toEqual({ kind: "unavailable", reason: "host-start-failed" });
    await expect(second).resolves.toEqual({ kind: "unavailable", reason: "host-start-failed" });
    expect(spawn).not.toHaveBeenCalled();
    expect(gateway.close).toHaveBeenCalledOnce();
  });

  it("seeds the hosted player with selected settings, volume and blocker state", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const prepare = vi.fn(createSession);
    const host = new WebView2ProtectedPlaybackHost(prepare);
    const opening = host.open({
      ownerKey: "7:player-settings",
      ownerId: "player-settings",
      channelSlug: "primevideo",
      muted: true,
      volume: 32,
      blockerEnabled: false,
      window: fakeWindow(),
      onState: vi.fn(),
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(prepare).toHaveBeenCalledWith({
      channelSlug: "primevideo",
      muted: true,
      volume: 32,
      blockerEnabled: false,
      preferences: {
        language: "es",
        playback: { defaultQuality: "1080p" },
        playerControls: { showQuality: false },
        buffer: { maxBufferLengthSec: 42 },
        playbackAdvanced: { playerType: "site" },
        captions: { enabled: true },
      },
    });
    expect(child.stdin.write).toHaveBeenCalledWith(expect.stringContaining('"type":"session"'));
    child.stdout.emit("data", '{"type":"ready"}\n');
    await expect(opening).resolves.toEqual({ kind: "opened" });
    host.close("7:player-settings");
    child.emit("close");
  });

  it("holds placement through preparation and sends only the latest revision while native is busy", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const host = new WebView2ProtectedPlaybackHost(createSession);
    const ownerKey = "7:player-layout";
    const present = (revision: number, x: number, presentation: "docked" | "theater") =>
      host.present(ownerKey, {
        revision,
        presentation,
        blockerEnabled: true,
        layout: {
          kind: "visible",
          boundsCss: { x, y: 20, width: 640, height: 360 },
          clipCss: { x, y: 20, width: 640, height: 360 },
          radiusCss: 0,
        },
      });
    const firstPlacement = present(1, 10, "docked");
    const opening = host.open({
      ownerKey,
      ownerId: "player-layout",
      channelSlug: "primevideo",
      muted: false,
      preferences: {},
      window: fakeWindow(),
      onState: vi.fn(),
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    expect(child.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"type":"present","revision":1')
    );
    const secondPlacement = present(2, 20, "docked");
    const finalPlacement = present(3, 30, "theater");
    child.stdout.emit("data", '{"type":"presented","message":"1"}\n');
    expect(child.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"type":"present","revision":3')
    );
    expect(child.stdin.write).toHaveBeenCalledWith(
      expect.stringContaining('"presentation":"theater"')
    );
    expect(child.stdin.write).not.toHaveBeenCalledWith(
      expect.stringContaining('"type":"present","revision":2')
    );
    child.stdout.emit("data", '{"type":"presented","message":"3"}\n{"type":"ready"}\n');
    await Promise.all([firstPlacement, secondPlacement, finalPlacement]);
    await expect(opening).resolves.toEqual({ kind: "opened" });
    host.close(ownerKey);
    child.emit("close");
  });

  it("does not report opened until the first supplied placement is applied", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const host = new WebView2ProtectedPlaybackHost(createSession);
    const ownerKey = "7:first-placement";
    const placement = host.present(ownerKey, {
      revision: 1,
      presentation: "docked",
      blockerEnabled: true,
      layout: {
        kind: "visible",
        boundsCss: { x: 10, y: 20, width: 640, height: 360 },
        clipCss: { x: 10, y: 20, width: 640, height: 360 },
        radiusCss: 0,
      },
    });
    const opening = host.open({
      ownerKey,
      ownerId: "first-placement",
      channelSlug: "primevideo",
      muted: false,
      preferences: {},
      window: fakeWindow(),
      onState: vi.fn(),
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    let opened = false;
    void opening.then(() => {
      opened = true;
    });
    child.stdout.emit("data", '{"type":"ready"}\n');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(opened).toBe(false);
    child.stdout.emit("data", '{"type":"presented","message":"1"}\n');
    await placement;
    await expect(opening).resolves.toEqual({ kind: "opened" });
    host.close(ownerKey);
    child.emit("close");
  });

  it("accepts several bounded native events delivered in one stdout chunk", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const onState = vi.fn();
    const host = new WebView2ProtectedPlaybackHost(createSession);
    const opening = host.open({
      ownerKey: "7:player-events",
      ownerId: "player-events",
      channelSlug: "primevideo",
      muted: false,
      preferences: {},
      window: fakeWindow(),
      onState,
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.emit("data", '{"type":"ready"}\n');
    await expect(opening).resolves.toEqual({ kind: "opened" });
    child.stdout.emit(
      "data",
      Array.from(
        { length: 120 },
        () => '{"type":"drag","message":"{\\"dx\\":1,\\"dy\\":2}"}\n'
      ).join("")
    );
    expect(onState).toHaveBeenCalledTimes(120);
    expect(onState).toHaveBeenLastCalledWith({
      kind: "drag",
      ownerId: "player-events",
      dx: 1,
      dy: 2,
    });
    host.close("7:player-events");
    child.emit("close");
  });

  it("suppresses a hidden parent and raises the child after restore without a timer", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const window = fakeWindow();
    const host = new WebView2ProtectedPlaybackHost(createSession);
    const opening = host.open({
      ownerKey: "7:parent",
      ownerId: "parent",
      channelSlug: "primevideo",
      muted: false,
      preferences: {},
      window,
      onState: vi.fn(),
    });
    await vi.waitFor(() => expect(spawn).toHaveBeenCalledOnce());
    child.stdout.emit("data", '{"type":"ready"}\n');
    await opening;
    window.emit("hide");
    expect(child.stdin.write).toHaveBeenCalledWith('{"type":"suspend"}\n');
    window.emit("restore");
    expect(child.stdin.write).toHaveBeenCalledWith('{"type":"raise"}\n');
    host.close("7:parent");
    child.emit("close");
  });
});
