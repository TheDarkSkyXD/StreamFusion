import { describe, expect, it, vi } from "vitest";

const electronNotification = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>;
    listeners: Record<string, () => void>;
    on: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock("electron", () => {
  class Notification {
    static isSupported = vi.fn(() => true);
    options: Record<string, unknown>;
    listeners: Record<string, () => void> = {};
    on = vi.fn((event: string, callback: () => void) => {
      this.listeners[event] = callback;
      return this;
    });
    show = vi.fn();

    constructor(options: Record<string, unknown>) {
      this.options = options;
      electronNotification.instances.push(this);
    }
  }

  class BrowserWindow {
    isDestroyed = vi.fn(() => false);
    isMinimized = vi.fn(() => true);
    restore = vi.fn();
    show = vi.fn();
    focus = vi.fn();
    webContents = { isDestroyed: vi.fn(() => false), send: vi.fn() };
  }

  return { Notification, BrowserWindow };
});

import { BrowserWindow } from "electron";

import {
  getLiveNotificationFollows,
  LiveNotificationService,
  type LiveNotificationSource,
  showLiveDesktopNotification,
} from "@backend/services/live-notification-service";
import { storageService } from "@backend/services/storage-service";
import {
  DEFAULT_USER_PREFERENCES,
  type LiveNotificationPayload,
  type LocalFollow,
  type UserPreferences,
} from "@shared/auth-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { createMainRendererPortMock } from "../../helpers/main-renderer-port-mock";

function follow(overrides: Partial<LocalFollow> = {}): LocalFollow {
  return {
    id: "follow-twitch-alpha",
    platform: "twitch",
    channelId: "123",
    channelName: "alpha",
    displayName: "Alpha",
    profileImage: "https://example.com/alpha.png",
    followedAt: "2026-01-01T00:00:00.000Z",
    source: "guest",
    ...overrides,
  };
}

function preferences(overrides: Partial<UserPreferences["notifications"]> = {}): UserPreferences {
  return {
    ...DEFAULT_USER_PREFERENCES,
    notifications: {
      ...DEFAULT_USER_PREFERENCES.notifications,
      ...overrides,
      perChannelNotifications: {
        ...DEFAULT_USER_PREFERENCES.notifications.perChannelNotifications,
        ...(overrides.perChannelNotifications ?? {}),
      },
    },
  };
}

function notification(overrides: Partial<LiveNotificationPayload> = {}): LiveNotificationPayload {
  return {
    id: "twitch:123:1000",
    platform: "twitch",
    channelId: "123",
    channelName: "alpha",
    channelDisplayName: "Alpha",
    title: "Live now",
    createdAt: 1_000,
    channelAvatar: "https://example.com/alpha.png",
    ...overrides,
  };
}

function createService(
  args: {
    follows?: LocalFollow[];
    source?: LiveNotificationSource;
    userPreferences?: UserPreferences;
    desktopNotificationsSupported?: () => boolean;
    now?: () => number;
    intervalMs?: number;
    setInterval?: (callback: () => void, ms: number) => unknown;
    clearInterval?: (handle: unknown) => void;
  } = {}
) {
  const source =
    args.source ??
    vi.fn(async () => [
      {
        id: "stream-1",
        platform: "twitch" as const,
        channelId: "123",
        channelName: "alpha",
        channelDisplayName: "Alpha",
        channelAvatar: "https://example.com/alpha.png",
        title: "Already live",
        viewerCount: 42,
        thumbnailUrl: "",
        isLive: true,
        startedAt: "2026-07-01T00:00:00.000Z",
        language: "en",
        tags: [],
      },
    ]);
  const emitInApp = vi.fn();
  const showDesktop = vi.fn();
  const service = new LiveNotificationService({
    getFollows: () => args.follows ?? [follow()],
    getPreferences: () => args.userPreferences ?? preferences(),
    sources: { twitch: source, kick: vi.fn(async () => []) },
    emitInApp,
    showDesktop,
    desktopNotificationsSupported: args.desktopNotificationsSupported ?? (() => true),
    now: args.now ?? (() => 1_000),
    intervalMs: args.intervalMs,
    setInterval: args.setInterval,
    clearInterval: args.clearInterval,
  });

  return { service, source, emitInApp, showDesktop };
}

// Guards: Live Notification startup must seed current live state silently so opening StreamFusion never bursts desktop or in-app alerts.
describe("LiveNotificationService", () => {
  it("includes guest Kick follows in notification candidates even when account follows are inactive", () => {
    const guestKickFollow = follow({
      id: "guest-kick-row",
      platform: "kick",
      channelId: "411439",
      channelName: "summit1g",
      displayName: "Summit1G",
      source: "guest",
    });
    const getActive = vi
      .spyOn(storageService, "getActiveFollowsByPlatform")
      .mockImplementation(() => []);
    const getGuest = vi.spyOn(storageService, "getGuestFollowsByPlatform").mockImplementation((platform) =>
      platform === "kick" ? [guestKickFollow] : []
    );

    expect(getLiveNotificationFollows()).toEqual([guestKickFollow]);
    getActive.mockRestore();
    getGuest.mockRestore();
  });

  it("seeds current live channels silently on startup", async () => {
    const { service, emitInApp, showDesktop } = createService();

    await service.start();

    expect(emitInApp).not.toHaveBeenCalled();
    expect(showDesktop).not.toHaveBeenCalled();
  });

  it("emits an in-app notification when a followed channel transitions from offline to online", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "stream-1",
          platform: "twitch",
          channelId: "123",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          channelAvatar: "https://example.com/alpha.png",
          title: "We are live",
          viewerCount: 42,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const { service, emitInApp } = createService({
      source,
      userPreferences: preferences({ enabled: false }),
    });

    await service.start();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledWith({
      id: "twitch:123:1000",
      platform: "twitch",
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "We are live",
      createdAt: 1_000,
    });
  });

  it("emits an in-app notification when a followed Kick channel transitions from offline to online", async () => {
    const kickSource = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "kick-stream-1",
          platform: "kick",
          channelId: "456",
          channelName: "bravo",
          channelDisplayName: "Bravo",
          channelAvatar: "https://example.com/bravo.png",
          title: "Kick live",
          viewerCount: 99,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const emitInApp = vi.fn();
    const service = new LiveNotificationService({
      getFollows: () => [
        follow({
          platform: "kick",
          channelId: "456",
          channelName: "bravo",
          displayName: "Bravo",
        }),
      ],
      getPreferences: () => preferences({ enabled: false }),
      sources: { twitch: vi.fn(async () => []), kick: kickSource },
      emitInApp,
      showDesktop: vi.fn(),
      desktopNotificationsSupported: () => true,
      now: () => 1_000,
    });

    await service.start();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledWith({
      id: "kick:456:1000",
      platform: "kick",
      channelId: "456",
      channelName: "bravo",
      channelDisplayName: "Bravo",
      channelAvatar: "https://example.com/bravo.png",
      title: "Kick live",
      createdAt: 1_000,
    });
  });

  it("matches Kick live streams by slug when public stream ids differ from followed ids", async () => {
    const kickSource = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "kick-stream-1",
          platform: "kick",
          channelId: "legacy-channel-20120336",
          channelName: "hennytingzz",
          channelDisplayName: "Hennytingzz",
          channelAvatar: "https://example.com/hennytingzz.png",
          title: "Kick live with mismatched ids",
          viewerCount: 99,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "kick-stream-2",
          platform: "kick",
          channelId: "legacy-channel-20120336",
          channelName: "hennytingzz",
          channelDisplayName: "Hennytingzz",
          channelAvatar: "https://example.com/hennytingzz.png",
          title: "Kick live again",
          viewerCount: 99,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:10:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const emitInApp = vi.fn();
    const service = new LiveNotificationService({
      getFollows: () => [
        follow({
          platform: "kick",
          channelId: "stable-user-21103818",
          channelName: "hennytingzz",
          displayName: "Hennytingzz",
        }),
      ],
      getPreferences: () =>
        preferences({
          enabled: false,
          favoriteChannelsOnly: true,
          perChannelNotifications: { "kick:stable-user-21103818": true },
        }),
      sources: { twitch: vi.fn(async () => []), kick: kickSource },
      emitInApp,
      showDesktop: vi.fn(),
      desktopNotificationsSupported: () => true,
      now,
    });

    await service.start();
    await service.pollOnce();
    await service.pollOnce();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledTimes(2);
    expect(emitInApp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: "kick:legacy-channel-20120336:1000",
        channelName: "hennytingzz",
        title: "Kick live with mismatched ids",
      })
    );
    expect(emitInApp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: "kick:legacy-channel-20120336:2000",
        channelName: "hennytingzz",
        title: "Kick live again",
      })
    );
  });

  it("falls back to the stored follow avatar when a live observation has no avatar", async () => {
    const kickSource = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "kick-stream-1",
          platform: "kick",
          channelId: "456",
          channelName: "seishinbushi",
          channelDisplayName: "Seishinbushi",
          channelAvatar: "",
          title: "Kick live",
          viewerCount: 99,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const emitInApp = vi.fn();
    const service = new LiveNotificationService({
      getFollows: () => [
        follow({
          platform: "kick",
          channelId: "456",
          channelName: "seishinbushi",
          displayName: "Seishinbushi",
          profileImage: "https://example.com/seishinbushi.webp",
          source: "kick",
        }),
      ],
      getPreferences: () => preferences({ enabled: false }),
      sources: { twitch: vi.fn(async () => []), kick: kickSource },
      emitInApp,
      showDesktop: vi.fn(),
      desktopNotificationsSupported: () => true,
      now: () => 1_000,
    });

    await service.start();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledWith(
      expect.objectContaining({
        channelAvatar: "https://example.com/seishinbushi.webp",
      })
    );
  });

  it("shows desktop notifications only when desktop and live notifications are enabled and supported", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "stream-1",
          platform: "twitch",
          channelId: "123",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          channelAvatar: "https://example.com/alpha.png",
          title: "Desktop live",
          viewerCount: 42,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const { service, showDesktop } = createService({ source });

    await service.start();
    await service.pollOnce();

    expect(showDesktop).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "twitch:123:1000",
        channelDisplayName: "Alpha",
        title: "Desktop live",
      }),
      { silent: false }
    );
  });

  it("does not show desktop notifications when the desktop preference is disabled", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "stream-1",
          platform: "twitch",
          channelId: "123",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          channelAvatar: "https://example.com/alpha.png",
          title: "In-app only",
          viewerCount: 42,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const { service, emitInApp, showDesktop } = createService({
      source,
      userPreferences: preferences({ enabled: false, sound: true }),
    });

    await service.start();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledWith(
      expect.objectContaining({ id: "twitch:123:1000", title: "In-app only" })
    );
    expect(showDesktop).not.toHaveBeenCalled();
  });

  it("uses a silent desktop notification when sound is disabled", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "stream-1",
          platform: "twitch",
          channelId: "123",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          channelAvatar: "https://example.com/alpha.png",
          title: "Quiet desktop",
          viewerCount: 42,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const { service, showDesktop } = createService({
      source,
      userPreferences: preferences({ sound: false }),
    });

    await service.start();
    await service.pollOnce();

    expect(showDesktop).toHaveBeenCalledWith(expect.any(Object), { silent: true });
  });

  it("keeps in-app history when OS desktop notifications are unsupported", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "stream-1",
          platform: "twitch",
          channelId: "123",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          channelAvatar: "https://example.com/alpha.png",
          title: "Unsupported desktop",
          viewerCount: 42,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const { service, emitInApp, showDesktop } = createService({
      source,
      desktopNotificationsSupported: () => false,
    });

    await service.start();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Unsupported desktop" })
    );
    expect(showDesktop).not.toHaveBeenCalled();
  });

  it("reports desktop support and degraded live source coverage without disabling in-app history", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Helix unavailable"))
      .mockResolvedValueOnce([]);
    const { service, emitInApp } = createService({
      source,
      desktopNotificationsSupported: () => false,
    });

    await service.start();
    await service.pollOnce();

    expect(service.getCoverageStatus()).toMatchObject({
      desktop: { supported: false, permission: "unsupported" },
      platforms: {
        twitch: {
          status: "degraded",
          issues: [
            expect.objectContaining({
              reason: "polling-failed",
              safeContext: { message: "Helix unavailable" },
            }),
          ],
        },
        kick: { status: "normal", issues: [] },
      },
    });

    service.reportCoverageHealthy("twitch", "polling-failed");
    expect(service.getCoverageStatus().platforms.twitch).toEqual({
      status: "normal",
      issues: [],
    });
    expect(emitInApp).not.toHaveBeenCalled();
  });

  it("tracks explicit degraded coverage reasons for source limits and platform health", async () => {
    const { service } = createService({
      follows: [
        follow({ id: "follow-1", channelId: "1", channelName: "one" }),
        follow({ id: "follow-2", channelId: "2", channelName: "two" }),
      ],
      source: vi.fn(async () => []),
    });

    service.reportCoverageDegraded({
      platform: "twitch",
      reason: "subscription-limit",
      message: "Twitch EventSub subscription limit reached",
      safeContext: { attempted: 2, subscribed: 1 },
    });
    service.reportCoverageDegraded({
      platform: "kick",
      reason: "polling-limited",
      message: "Kick polling is delayed by bounded concurrency",
      safeContext: { followCount: 2, maxConcurrency: 1 },
    });
    service.reportCoverageDegraded({
      platform: "kick",
      reason: "platform-health",
      message: "Kick status page reports degraded API health",
      safeContext: { status: "degraded" },
    });

    expect(service.getCoverageStatus()).toMatchObject({
      platforms: {
        twitch: {
          status: "degraded",
          issues: [expect.objectContaining({ reason: "subscription-limit" })],
        },
        kick: {
          status: "degraded",
          issues: [
            expect.objectContaining({ reason: "polling-limited" }),
            expect.objectContaining({ reason: "platform-health" }),
          ],
        },
      },
    });
  });

  it("marks many-follow monitoring as degraded when configured batching limits are exceeded", async () => {
    const source = vi.fn<LiveNotificationSource>().mockResolvedValue([]);
    const service = new LiveNotificationService({
      getFollows: () => [
        follow({ id: "follow-1", channelId: "1", channelName: "one" }),
        follow({ id: "follow-2", channelId: "2", channelName: "two" }),
      ],
      getPreferences: () => preferences(),
      sources: { twitch: source, kick: vi.fn(async () => []) },
      emitInApp: vi.fn(),
      showDesktop: vi.fn(),
      desktopNotificationsSupported: () => true,
      now: () => 1_000,
      maxFollowsBeforeDegraded: { twitch: 1 },
    });

    await service.pollOnce();

    expect(service.getCoverageStatus().platforms.twitch).toMatchObject({
      status: "degraded",
      issues: [
        expect.objectContaining({
          reason: "many-follows",
          safeContext: { followCount: 2, maxFollows: 1 },
        }),
      ],
    });
  });

  it("respects guest follow, platform, and per-channel notification preferences", async () => {
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "stream-1",
          platform: "twitch",
          channelId: "123",
          channelName: "alpha",
          channelDisplayName: "Alpha",
          channelAvatar: "https://example.com/alpha.png",
          title: "Muted by preferences",
          viewerCount: 42,
          thumbnailUrl: "",
          isLive: true,
          startedAt: "2026-07-01T00:00:00.000Z",
          language: "en",
          tags: [],
        },
      ]);
    const { service, emitInApp, showDesktop } = createService({
      source,
      userPreferences: preferences({
        guestFollows: true,
        twitch: true,
        favoriteChannelsOnly: true,
        perChannelNotifications: { "twitch:123": false },
      }),
    });

    await service.start();
    await service.pollOnce();

    expect(emitInApp).not.toHaveBeenCalled();
    expect(showDesktop).not.toHaveBeenCalled();
  });

  it("does not duplicate notifications while a channel remains continuously live", async () => {
    const liveStream = {
      id: "stream-1",
      platform: "twitch" as const,
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Still live",
      viewerCount: 42,
      thumbnailUrl: "",
      isLive: true,
      startedAt: "2026-07-01T00:00:00.000Z",
      language: "en",
      tags: [],
    };
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([liveStream])
      .mockResolvedValueOnce([liveStream]);
    const { service, emitInApp } = createService({ source });

    await service.start();
    await service.pollOnce();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledTimes(1);
  });

  it("notifies every observed offline-to-online restart when restart grace is off", async () => {
    const liveStream = {
      id: "stream-1",
      platform: "twitch" as const,
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Back live",
      viewerCount: 42,
      thumbnailUrl: "",
      isLive: true,
      startedAt: "2026-07-01T00:00:00.000Z",
      language: "en",
      tags: [],
    };
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([liveStream])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([liveStream]);
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const { service, emitInApp } = createService({ source, now });

    await service.start();
    await service.pollOnce();
    await service.pollOnce();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledTimes(2);
    expect(emitInApp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "twitch:123:1000" })
    );
    expect(emitInApp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "twitch:123:2000" })
    );
  });

  it("suppresses restart notifications inside the configured grace period", async () => {
    const liveStream = {
      id: "stream-1",
      platform: "twitch" as const,
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Back live quickly",
      viewerCount: 42,
      thumbnailUrl: "",
      isLive: true,
      startedAt: "2026-07-01T00:00:00.000Z",
      language: "en",
      tags: [],
    };
    const source = vi
      .fn<LiveNotificationSource>()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([liveStream])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([liveStream]);
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const { service, emitInApp } = createService({
      source,
      now,
      userPreferences: preferences({ restartGracePeriodMinutes: 5 }),
    });

    await service.start();
    await service.pollOnce();
    await service.pollOnce();
    await service.pollOnce();

    expect(emitInApp).toHaveBeenCalledTimes(1);
  });

  it("starts scheduled polling and stops the timer on shutdown", async () => {
    const handle = { id: "timer" };
    const setInterval = vi.fn(() => handle);
    const clearInterval = vi.fn();
    const { service } = createService({ intervalMs: 5_000, setInterval, clearInterval });

    await service.start();
    service.stop();

    expect(setInterval).toHaveBeenCalledWith(expect.any(Function), 5_000);
    expect(clearInterval).toHaveBeenCalledWith(handle);
  });

  it("reconciles auth changes silently without emitting notification bursts", async () => {
    const source = vi.fn<LiveNotificationSource>().mockResolvedValue([
      {
        id: "stream-1",
        platform: "twitch",
        channelId: "123",
        channelName: "alpha",
        channelDisplayName: "Alpha",
        channelAvatar: "https://example.com/alpha.png",
        title: "Live during auth",
        viewerCount: 42,
        thumbnailUrl: "",
        isLive: true,
        startedAt: "2026-07-01T00:00:00.000Z",
        language: "en",
        tags: [],
      },
    ]);
    const { service, emitInApp, showDesktop } = createService({ source });

    await service.reconcileSilently();

    expect(emitInApp).not.toHaveBeenCalled();
    expect(showDesktop).not.toHaveBeenCalled();
  });

  it("emits through the notification pipeline when Twitch EventSub observes a followed channel online", async () => {
    const source = vi.fn<LiveNotificationSource>().mockResolvedValue([]);
    const { service, emitInApp, showDesktop } = createService({ source });

    await service.start();
    service.observeOnline({
      platform: "twitch",
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Live now",
    });

    expect(emitInApp).toHaveBeenCalledWith({
      id: "twitch:123:1000",
      platform: "twitch",
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Live now",
      createdAt: 1_000,
    });
    expect(showDesktop).toHaveBeenCalledWith(expect.objectContaining({ title: "Live now" }), {
      silent: false,
    });
  });

  it("dedupes repeated EventSub online deliveries until an offline event resets the channel", async () => {
    const source = vi.fn<LiveNotificationSource>().mockResolvedValue([]);
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000);
    const { service, emitInApp } = createService({ source, now });
    const onlineObservation = {
      platform: "twitch" as const,
      channelId: "123",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      channelAvatar: "https://example.com/alpha.png",
      title: "Live from EventSub",
    };

    await service.start();
    service.observeOnline(onlineObservation);
    service.observeOnline(onlineObservation);
    service.observeOffline({ platform: "twitch", channelId: "123", channelName: "alpha" });
    service.observeOnline(onlineObservation);

    expect(emitInApp).toHaveBeenCalledTimes(2);
    expect(emitInApp).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ id: "twitch:123:1000" })
    );
    expect(emitInApp).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ id: "twitch:123:2000" })
    );
  });

  it("focuses the window and pushes stream navigation when a desktop notification is clicked", () => {
    electronNotification.instances.length = 0;
    const send = vi.fn();
    const mainWindow = new BrowserWindow();
    vi.mocked(mainWindow.webContents.send).mockImplementation(send);
    const payload = notification({ platform: "kick", channelId: "200", channelName: "xqc" });

    showLiveDesktopNotification(createMainRendererPortMock(mainWindow), payload, { silent: true });
    electronNotification.instances[0]?.listeners.click?.();

    expect(mainWindow.restore).toHaveBeenCalledTimes(1);
    expect(mainWindow.show).toHaveBeenCalledTimes(1);
    expect(mainWindow.focus).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(IPC_CHANNELS.NOTIFICATION_OPEN_STREAM, payload);
    expect(electronNotification.instances[0]?.options).toMatchObject({ silent: true });
  });
});
