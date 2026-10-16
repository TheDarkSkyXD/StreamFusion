import { EventEmitter } from "node:events";
import { join } from "node:path";
import type { BrowserWindow } from "electron";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawn = vi.hoisted(() => vi.fn());
vi.mock("node:child_process", () => ({ spawn }));
vi.mock("electron", () => ({
  app: { isPackaged: false, getPath: () => "C:\\profile" },
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

describe("WebView2 protected player host", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform")!;
  beforeEach(() => {
    spawn.mockReset();
    Object.defineProperty(process, "platform", { configurable: true, value: "win32" });
  });
  afterEach(() => Object.defineProperty(process, "platform", originalPlatform));

  it("reports the unavailable platform without starting a helper", async () => {
    Object.defineProperty(process, "platform", { configurable: true, value: "linux" });
    const host = new WebView2ProtectedPlaybackHost();
    await expect(
      host.open({
        ownerKey: "7:player-1",
        ownerId: "player-1",
        channelSlug: "primevideo",
        muted: false,
        window: { getNativeWindowHandle: () => Buffer.alloc(8) } as unknown as BrowserWindow,
        onState: vi.fn(),
      })
    ).resolves.toEqual({ kind: "unavailable", reason: "unsupported-platform" });
    expect(spawn).not.toHaveBeenCalled();
  });

  it("cancels a reopen that is waiting for the previous child to exit", async () => {
    const child = fakeChild();
    spawn.mockReturnValueOnce(child);
    const host = new WebView2ProtectedPlaybackHost();
    const input = {
      ownerKey: "7:player-1",
      ownerId: "player-1",
      channelSlug: "primevideo",
      muted: false,
      window: { getNativeWindowHandle: () => Buffer.alloc(8) } as unknown as BrowserWindow,
      onState: vi.fn(),
    };
    const first = host.open(input);
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
    const host = new WebView2ProtectedPlaybackHost();
    const opening = host.open({
      ownerKey: "7:player-2",
      ownerId: "player-2",
      channelSlug: "primevideo",
      muted: true,
      window: { getNativeWindowHandle: () => Buffer.alloc(8) } as unknown as BrowserWindow,
      onState,
    });
    child.stdout.emit("data", '{"type":"failed","message":"runtime-missing"}\n');
    await expect(opening).resolves.toEqual({ kind: "unavailable", reason: "runtime-missing" });
    expect(onState).toHaveBeenCalledExactlyOnceWith({
      kind: "failed",
      ownerId: "player-2",
      reason: "runtime-missing",
    });
    child.emit("close");
  });
});
