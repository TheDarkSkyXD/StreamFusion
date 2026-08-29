import { afterEach, describe, expect, it, vi } from "vitest";

import { createStreamRecordingOutcomeCoordinator } from "@backend/services/stream-recording-outcome-coordinator";
import { createOwnedRecordingSectionPath } from "@backend/services/stream-recording-paths";
import { createStreamRecordingSessionStore } from "@backend/services/stream-recording-session-store";
import type {
  StreamRecordingArtifactIdentity,
  StreamRecordingJournal,
  StreamRecordingNotice,
} from "@shared/stream-recording-types";

const identity: StreamRecordingArtifactIdentity = {
  algorithm: "sha256",
  digest: "a".repeat(64),
  size: 100,
};

function createStore() {
  let journal: StreamRecordingJournal = {
    version: 1,
    session: {
      id: "recording-session-1",
      platform: "twitch",
      channelName: "ninja",
      title: "Ranked",
      status: "finalizing",
      destinationPath: "D:/Videos/Ranked.mp4",
      qualityLabel: "Source",
      capturedDurationSeconds: 30,
      sections: [
        {
          id: "recording-session-1-part-1",
          path: createOwnedRecordingSectionPath("D:/Videos/Ranked.mp4", "recording-session-1", 1),
          startedAt: "2026-07-11T12:00:00.000Z",
          endedAt: "2026-07-11T12:00:30.000Z",
        },
      ],
      gaps: [],
      createdAt: "2026-07-11T12:00:00.000Z",
      updatedAt: "2026-07-11T12:00:30.000Z",
    },
  };
  return createStreamRecordingSessionStore({
    storage: {
      getStreamRecordingJournal: () => journal,
      saveStreamRecordingJournal: (next) => {
        journal = next;
      },
    },
  });
}

function completedNotice(): StreamRecordingNotice {
  return {
    sessionId: "recording-session-1",
    outcome: "completed",
    platform: "twitch",
    channelName: "ninja",
    title: "Ranked",
    outputPath: "D:/Videos/Ranked.mp4",
    outputFormat: "mp4",
    artifactIdentity: identity,
  };
}

// Guards: terminal recording outcomes route to exactly one focus-appropriate surface.
// Guards: recording file actions require the current session identity and verified owned artifact.
// Guards: stale notice timers and native clicks cannot erase or re-announce a newer outcome.
describe("stream recording outcome coordinator", () => {
  afterEach(() => vi.useRealTimers());

  it.each([
    {
      name: "minimized",
      context: { visible: true, focused: true, minimized: true },
      enabled: true,
      supported: true,
      delivery: "native",
    },
    {
      name: "hidden",
      context: { visible: false, focused: false, minimized: false },
      enabled: true,
      supported: true,
      delivery: "native",
    },
    {
      name: "notifications disabled",
      context: { visible: true, focused: false, minimized: false },
      enabled: false,
      supported: true,
      delivery: "none",
    },
    {
      name: "notifications unsupported",
      context: { visible: true, focused: false, minimized: false },
      enabled: true,
      supported: false,
      delivery: "none",
    },
  ] as const)("routes $name terminal delivery without duplicate surfaces", ({
    context,
    enabled,
    supported,
    delivery,
  }) => {
    const store = createStore();
    const showNative = vi.fn();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        ...context,
        notificationsEnabled: enabled,
        soundEnabled: true,
        nativeSupported: supported,
      }),
      showNative,
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: vi.fn(),
    });

    coordinator.settle("recording-session-1", completedNotice());

    expect(store.getSnapshot().notice?.delivery).toBe(delivery);
    expect(showNative).toHaveBeenCalledTimes(delivery === "native" ? 1 : 0);
  });

  it("delivers a focused terminal outcome once in-app without a native notification", () => {
    const store = createStore();
    const showNative = vi.fn();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative,
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: vi.fn(),
    });

    expect(coordinator.settle("recording-session-1", completedNotice())).toBe(true);
    expect(store.getSnapshot()).toEqual({
      active: null,
      notice: expect.objectContaining({
        sessionId: "recording-session-1",
        outcome: "completed",
        delivery: "in-app",
      }),
    });
    expect(showNative).not.toHaveBeenCalled();
  });

  it("delivers an unfocused outcome natively and promotes one valid click to in-app", () => {
    const store = createStore();
    let click: (() => void) | undefined;
    const showNative = vi.fn((input: { onClick: () => void }) => {
      click = input.onClick;
    });
    const focusWindow = vi.fn();
    const snapshots: StreamRecordingNotice[] = [];
    store.subscribe((snapshot) => {
      if (snapshot.notice) snapshots.push(snapshot.notice);
    });
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: false,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: false,
        nativeSupported: true,
      }),
      showNative,
      focusWindow,
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: vi.fn(),
    });

    coordinator.settle("recording-session-1", completedNotice());
    expect(showNative).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Recording completed",
        body: "Ranked was saved.",
        silent: true,
      })
    );
    expect(snapshots.map((notice) => notice.delivery)).toEqual(["native"]);

    click?.();
    click?.();

    expect(focusWindow).toHaveBeenCalledTimes(1);
    expect(snapshots.map((notice) => notice.delivery)).toEqual(["native", "in-app"]);
  });

  it.each([
    {
      name: "visible window",
      visible: true,
      minimized: false,
      fallback: "in-app",
    },
    {
      name: "hidden minimized window",
      visible: false,
      minimized: true,
      fallback: "none",
    },
  ] as const)("keeps successful settlement when native presentation throws for a $name", ({
    visible,
    minimized,
    fallback,
  }) => {
    const store = createStore();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible,
        focused: false,
        minimized,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: () => {
        throw new Error("native notification constructor failed");
      },
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: vi.fn(),
    });

    expect(() => coordinator.settle("recording-session-1", completedNotice())).not.toThrow();
    expect(store.getJournal()).toEqual({ version: 2, state: "empty", session: null });
    expect(store.getSnapshot().notice).toMatchObject({
      sessionId: "recording-session-1",
      delivery: fallback,
    });
  });

  it("expires only its own notice and leaves a newer terminal outcome intact", () => {
    const store = createStore();
    let expire: (() => void) | undefined;
    const scheduleClear = vi.fn((callback: () => void, delayMs: number) => {
      expire = callback;
      return delayMs;
    });
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: vi.fn(),
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear,
      noticeTtlMs: 12_000,
    });

    coordinator.settle("recording-session-1", completedNotice());
    expect(scheduleClear).toHaveBeenCalledWith(expect.any(Function), 12_000);

    store.setNotice({
      sessionId: "new-session",
      outcome: "failed",
      platform: "kick",
      channelName: "xqc",
      title: "New stream",
      error: "No playable output",
      delivery: "in-app",
    });
    expire?.();

    expect(store.getSnapshot().notice?.sessionId).toBe("new-session");
  });

  it("clears a transient outcome at its TTL without waiting on real time", async () => {
    vi.useFakeTimers();
    const store = createStore();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: vi.fn(),
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: (callback, delayMs) => setTimeout(callback, delayMs),
      noticeTtlMs: 10_000,
    });
    coordinator.settle("recording-session-1", completedNotice());

    await vi.advanceTimersByTimeAsync(9_999);
    expect(store.getSnapshot().notice?.sessionId).toBe("recording-session-1");
    await vi.advanceTimersByTimeAsync(1);
    expect(store.getSnapshot().notice).toBeNull();
  });

  it("opens only the current recording-owned artifact after existence and identity checks", async () => {
    const store = createStore();
    const openPath = vi.fn(async () => "");
    const verifyArtifactIdentity = vi.fn(async () => true);
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: vi.fn(),
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: (path) => path === "D:/Videos/Ranked.mp4",
        openPath,
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity,
      scheduleClear: vi.fn(),
    });
    coordinator.settle("recording-session-1", completedNotice());

    await expect(coordinator.open("wrong-session")).resolves.toEqual({
      success: false,
      error: "Recording outcome not found",
    });
    await expect(coordinator.open("recording-session-1")).resolves.toEqual({ success: true });

    expect(verifyArtifactIdentity).toHaveBeenCalledWith("D:/Videos/Ranked.mp4", identity);
    expect(openPath).toHaveBeenCalledWith("D:/Videos/Ranked.mp4");
  });

  it("shows and dismisses only the current recording outcome by session identity", async () => {
    const store = createStore();
    const showItemInFolder = vi.fn();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: vi.fn(),
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: async () => "",
        showItemInFolder,
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: vi.fn(),
    });
    coordinator.settle("recording-session-1", completedNotice());

    await expect(coordinator.show("wrong-session")).resolves.toEqual({
      success: false,
      error: "Recording outcome not found",
    });
    await expect(coordinator.show("recording-session-1")).resolves.toEqual({ success: true });
    expect(showItemInFolder).toHaveBeenCalledWith("D:/Videos/Ranked.mp4");
    expect(coordinator.dismiss("wrong-session")).toBe(false);
    expect(coordinator.dismiss("recording-session-1")).toBe(true);
    expect(coordinator.getCurrentNotice()).toBeNull();
  });

  it("returns typed failures when OS file actions throw or reject", async () => {
    const store = createStore();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: true,
        focused: true,
        minimized: false,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: vi.fn(),
      focusWindow: vi.fn(),
      recordingFileActions: {
        exists: () => true,
        openPath: vi.fn(async () => {
          throw new Error("player launch failed");
        }),
        showItemInFolder: vi.fn(() => {
          throw new Error("folder shell failed");
        }),
      },
      verifyArtifactIdentity: async () => true,
      scheduleClear: vi.fn(),
    });
    coordinator.settle("recording-session-1", completedNotice());

    await expect(coordinator.open("recording-session-1")).resolves.toEqual({
      success: false,
      error: "player launch failed",
    });
    await expect(coordinator.show("recording-session-1")).resolves.toEqual({
      success: false,
      error: "folder shell failed",
    });
  });

  it("does not promote an expired native outcome or expose file actions for Failed", async () => {
    const store = createStore();
    let click: (() => void) | undefined;
    const focusWindow = vi.fn();
    const coordinator = createStreamRecordingOutcomeCoordinator({
      sessionStore: store,
      getDeliveryContext: () => ({
        visible: false,
        focused: false,
        minimized: true,
        notificationsEnabled: true,
        soundEnabled: true,
        nativeSupported: true,
      }),
      showNative: (input) => {
        click = input.onClick;
      },
      focusWindow,
      recordingFileActions: {
        exists: vi.fn(),
        openPath: vi.fn(),
        showItemInFolder: vi.fn(),
      },
      verifyArtifactIdentity: vi.fn(),
      scheduleClear: vi.fn(),
    });
    coordinator.settle("recording-session-1", {
      sessionId: "recording-session-1",
      outcome: "failed",
      platform: "twitch",
      channelName: "ninja",
      title: "Ranked",
      error: "No playable output",
    });
    coordinator.dismiss("recording-session-1");

    click?.();

    expect(focusWindow).not.toHaveBeenCalled();
    await expect(coordinator.open("recording-session-1")).resolves.toEqual({
      success: false,
      error: "Recording outcome not found",
    });
  });
});
