import path from "node:path";

import { Notification } from "electron";
import { getTwitchEventSubClient } from "@backend/api/platforms/twitch/twitch-eventsub-client";
import {
  getPlatformHealth,
  getPlatformStatusPageDetail,
  onPlatformHealthChanged,
} from "@backend/api/unified/platform-health";
import type { UnifiedStream } from "@shared/platform-types";
import { logger } from "@backend/logging/logger";
import {
  isFollowEligibleForLiveNotification,
  liveNotificationChannelKey,
  resolveLiveNotificationDecision,
} from "@streamfusion/core/follows";
import {
  type DesktopNotificationPermissionStatus,
  type LiveNotificationCoverageIssue,
  type LiveNotificationCoverageIssueReason,
  type LiveNotificationCoverageStatus,
  type LiveNotificationPayload,
  type LocalFollow,
  type Platform,
  TWITCH_APP_CLIENT_ID,
  type UserPreferences,
} from "@shared/auth-types";
import { IPC_CHANNELS } from "@shared/ipc-channels";
import { nativeText } from "@shared/i18n/native-copy.generated";
import { KickLiveNotificationSource } from "./kick-live-notification-source";
import { storageService } from "./storage-service";
import { getNativeText } from "./native-copy";
import type { MainRendererPort } from "@backend/ipc/main-renderer-port";
import { TwitchLiveEventSubSource } from "./twitch-live-eventsub-source";

export type LiveNotificationSource = (follows: LocalFollow[]) => Promise<UnifiedStream[]>;

export interface LiveNotificationObservation {
  platform: Platform;
  channelId: string;
  channelName: string;
  channelDisplayName: string;
  channelAvatar?: string | null;
  title: string;
}

export interface LiveNotificationServiceDeps {
  getFollows: () => LocalFollow[];
  getPreferences: () => UserPreferences;
  sources: Record<Platform, LiveNotificationSource>;
  emitInApp: (notification: LiveNotificationPayload) => void;
  showDesktop: (notification: LiveNotificationPayload, options: { silent: boolean }) => void;
  desktopNotificationsSupported: () => boolean;
  desktopNotificationPermission?: () => DesktopNotificationPermissionStatus;
  now: () => number;
  intervalMs?: number;
  setInterval?: (callback: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  maxFollowsBeforeDegraded?: Partial<Record<Platform, number>>;
}

export class LiveNotificationService {
  private liveByChannel = new Map<string, boolean>();
  private lastNotifiedAtByChannel = new Map<string, number>();
  private coverageIssuesByPlatform = new Map<
    Platform,
    Map<LiveNotificationCoverageIssueReason, LiveNotificationCoverageIssue>
  >();
  private timer: unknown = null;
  private isPolling = false;

  constructor(private readonly deps: LiveNotificationServiceDeps) {}

  async start(): Promise<void> {
    await this.reconcile({ silent: true });
    if (this.timer === null) {
      const setIntervalFn = this.deps.setInterval ?? globalThis.setInterval;
      this.timer = setIntervalFn(() => {
        void this.pollOnce();
      }, this.deps.intervalMs ?? 60_000);
    }
  }

  stop(): void {
    if (this.timer === null) return;
    if (this.deps.clearInterval) {
      this.deps.clearInterval(this.timer);
    } else {
      globalThis.clearInterval(this.timer as ReturnType<typeof setInterval>);
    }
    this.timer = null;
  }

  async pollOnce(): Promise<void> {
    if (this.isPolling) return;
    this.isPolling = true;
    try {
      await this.reconcile({ silent: false });
    } finally {
      this.isPolling = false;
    }
  }

  async reconcileSilently(): Promise<void> {
    await this.reconcile({ silent: true });
  }

  getCoverageStatus(): LiveNotificationCoverageStatus {
    const desktopSupported = this.deps.desktopNotificationsSupported();
    return {
      desktop: {
        supported: desktopSupported,
        permission: desktopSupported
          ? (this.deps.desktopNotificationPermission?.() ?? "unknown")
          : "unsupported",
      },
      platforms: {
        twitch: this.getPlatformCoverage("twitch"),
        kick: this.getPlatformCoverage("kick"),
      },
    };
  }

  reportCoverageDegraded(issue: {
    platform: Platform;
    reason: LiveNotificationCoverageIssueReason;
    message: string;
    safeContext?: LiveNotificationCoverageIssue["safeContext"];
  }): void {
    const now = this.deps.now();
    const platformIssues = this.getMutablePlatformIssues(issue.platform);
    const existing = platformIssues.get(issue.reason);
    platformIssues.set(issue.reason, {
      platform: issue.platform,
      reason: issue.reason,
      message: issue.message,
      safeContext: issue.safeContext,
      firstSeenAt: existing?.firstSeenAt ?? now,
      lastSeenAt: now,
    });
  }

  reportCoverageHealthy(platform: Platform, reason?: LiveNotificationCoverageIssueReason): void {
    const platformIssues = this.coverageIssuesByPlatform.get(platform);
    if (!platformIssues) return;
    if (reason) {
      platformIssues.delete(reason);
    } else {
      platformIssues.clear();
    }
  }

  observeOnline(observation: LiveNotificationObservation): void {
    const follow = this.findActiveFollow(observation);
    this.recordOnlineObservation(observation, { silent: false }, follow);
  }

  observeOffline(
    channel: Pick<LiveNotificationObservation, "platform" | "channelId" | "channelName">
  ): void {
    const follow = this.findActiveFollow(channel);
    this.liveByChannel.set(follow ? followKey(follow) : channelKey(channel), false);
  }

  private async reconcile(options: { silent: boolean }): Promise<void> {
    const follows = this.deps.getFollows();
    const followsByKey = new Map<string, LocalFollow>();
    const kickFollowsBySlug = new Map<string, LocalFollow>();
    const observedLiveByKey = new Map<string, boolean>();
    for (const follow of follows) {
      const key = followKey(follow);
      followsByKey.set(key, follow);
      if (follow.platform === "kick" && follow.channelName.trim() !== "") {
        kickFollowsBySlug.set(normalizedChannelName(follow.channelName), follow);
      }
      observedLiveByKey.set(key, false);
      if (!this.liveByChannel.has(key)) {
        this.liveByChannel.set(key, false);
      }
    }

    const streams = await Promise.all(
      (["twitch", "kick"] as Platform[]).map(async (platform) => {
        const platformFollows = follows.filter((follow) => follow.platform === platform);
        this.updateManyFollowsCoverage(platform, platformFollows.length);
        try {
          const platformStreams = await this.deps.sources[platform](platformFollows);
          this.reportCoverageHealthy(platform, "polling-failed");
          return platformStreams;
        } catch (error) {
          logger.warn("LiveNotifications", "Live Notification polling coverage degraded", {
            platform,
            reason: "polling-failed",
            message: errorMessage(error),
          });
          this.reportCoverageDegraded({
            platform,
            reason: "polling-failed",
            message: `${platform} live polling failed`,
            safeContext: { message: errorMessage(error) },
          });
          return [];
        }
      })
    );

    for (const stream of streams.flat()) {
      const follow =
        followsByKey.get(channelKey(stream)) ??
        (stream.platform === "kick"
          ? kickFollowsBySlug.get(normalizedChannelName(stream.channelName))
          : undefined);
      if (follow) {
        observedLiveByKey.set(followKey(follow), true);
      }
      this.recordOnlineObservation(stream, options, follow);
    }

    for (const [key, isLive] of observedLiveByKey) {
      if (!isLive) {
        this.liveByChannel.set(key, false);
      }
    }
  }

  private recordOnlineObservation(
    observation: LiveNotificationObservation,
    options: { silent: boolean },
    follow: LocalFollow | undefined
  ): void {
    if (!follow) return;

    const key = followKey(follow);
    const wasLive = this.liveByChannel.get(key) ?? false;
    this.liveByChannel.set(key, true);

    const userPreferences = this.deps.getPreferences();
    const isEligible = isFollowEligibleForLiveNotification({
      preferences: userPreferences.notifications,
      channel: {
        platform: observation.platform,
        id: follow.channelId || observation.channelId,
        username: follow.channelName || observation.channelName,
      },
      followSource: follow.source ?? null,
    });

    if (options.silent || wasLive || !isEligible) return;

    const createdAt = this.deps.now();
    const lastNotifiedAt = this.lastNotifiedAtByChannel.get(key);
    const decision = resolveLiveNotificationDecision({
      preferences: userPreferences.notifications,
      silentSync: false,
      wasLive: false,
      eligible: true,
      systemNotificationsSupported: this.deps.desktopNotificationsSupported(),
      nowMs: createdAt,
      ...(lastNotifiedAt === undefined ? {} : { lastNotifiedAtMs: lastNotifiedAt }),
    });
    if (decision.kind === "ignore") return;

    const notification: LiveNotificationPayload = {
      id: `${observation.platform}:${observation.channelId || observation.channelName}:${createdAt}`,
      platform: observation.platform,
      channelId: observation.channelId,
      channelName: observation.channelName,
      channelDisplayName: observation.channelDisplayName,
      channelAvatar: observation.channelAvatar || follow.profileImage || null,
      title: observation.title,
      createdAt,
    };
    this.deps.emitInApp(notification);
    this.lastNotifiedAtByChannel.set(key, createdAt);
    if (decision.systemNotification) {
      this.deps.showDesktop(notification, decision.systemNotification);
    }
  }

  private findActiveFollow(
    observation: Pick<LiveNotificationObservation, "platform" | "channelId" | "channelName">
  ): LocalFollow | undefined {
    const key = channelKey(observation);
    return this.deps.getFollows().find((follow) => {
      if (followKey(follow) === key) return true;
      return (
        observation.platform === "kick" &&
        follow.platform === "kick" &&
        normalizedChannelName(follow.channelName) === normalizedChannelName(observation.channelName)
      );
    });
  }

  private getPlatformCoverage(platform: Platform): {
    status: "normal" | "degraded";
    issues: LiveNotificationCoverageIssue[];
  } {
    const issues = [...(this.coverageIssuesByPlatform.get(platform)?.values() ?? [])];
    return {
      status: issues.length === 0 ? "normal" : "degraded",
      issues,
    };
  }

  private getMutablePlatformIssues(
    platform: Platform
  ): Map<LiveNotificationCoverageIssueReason, LiveNotificationCoverageIssue> {
    let issues = this.coverageIssuesByPlatform.get(platform);
    if (!issues) {
      issues = new Map();
      this.coverageIssuesByPlatform.set(platform, issues);
    }
    return issues;
  }

  private updateManyFollowsCoverage(platform: Platform, followCount: number): void {
    const maxFollows = this.deps.maxFollowsBeforeDegraded?.[platform];
    if (maxFollows === undefined || followCount <= maxFollows) {
      this.reportCoverageHealthy(platform, "many-follows");
      return;
    }
    this.reportCoverageDegraded({
      platform,
      reason: "many-follows",
      message: `${platform} follow count may delay live notification coverage`,
      safeContext: { followCount, maxFollows },
    });
  }
}

const LIVE_NOTIFICATION_POLL_INTERVAL_MS = 60_000;
const appIconPath = path.join(__dirname, "../../assets/icons/icon.png");

export function showLiveDesktopNotification(
  renderer: MainRendererPort,
  notification: LiveNotificationPayload,
  options: { silent: boolean; title?: string }
): void {
  const desktopNotification = new Notification({
    title:
      options.title ??
      nativeText("en", "channelIsLive", { channel: notification.channelDisplayName }),
    body: notification.title,
    icon: appIconPath,
    silent: options.silent,
  });
  desktopNotification.on("click", () => {
    const mainWindow = renderer.current();
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) {
        mainWindow.restore();
      }
      mainWindow.show();
      mainWindow.focus();
    }
    renderer.send(IPC_CHANNELS.NOTIFICATION_OPEN_STREAM, notification);
  });
  desktopNotification.show();
}

export function getLiveNotificationFollows(): LocalFollow[] {
  const followsById = new Map<string, LocalFollow>();
  for (const platform of ["twitch", "kick"] as Platform[]) {
    for (const follow of [
      ...storageService.getActiveFollowsByPlatform(platform),
      ...storageService.getGuestFollowsByPlatform(platform),
    ]) {
      followsById.set(follow.id, follow);
    }
  }
  return [...followsById.values()];
}

async function fetchTwitchLiveStreams(follows: LocalFollow[]): Promise<UnifiedStream[]> {
  const logins = [...new Set(follows.map((follow) => follow.channelName).filter(Boolean))];
  if (logins.length === 0) return [];
  const { twitchClient } = await import("../api/platforms/twitch/twitch-client");
  const result = await twitchClient.getStreamsByLogins(logins);
  return result.data;
}

async function fetchPublicKickStreamBySlug(
  slug: string,
  staggerOffsetMs?: number,
  signal?: AbortSignal
): Promise<UnifiedStream | null> {
  const { getPublicStreamBySlug } =
    await import("../api/platforms/kick/endpoints/stream-endpoints");
  return getPublicStreamBySlug(slug, staggerOffsetMs, signal);
}

class AppLiveNotificationService {
  private service: LiveNotificationService | null = null;
  private kickLiveSource: KickLiveNotificationSource | null = null;
  private twitchEventSubSource: TwitchLiveEventSubSource | null = null;
  private platformHealthCleanup: (() => void) | null = null;
  private renderer: MainRendererPort | null = null;

  start(renderer: MainRendererPort): void {
    this.renderer = renderer;
    if (!this.service) {
      this.service = new LiveNotificationService({
        getFollows: getLiveNotificationFollows,
        getPreferences: () => storageService.getPreferences(),
        sources: {
          twitch: fetchTwitchLiveStreams,
          kick: (follows) => this.getKickLiveSource().poll(follows),
        },
        emitInApp: (notification) => {
          this.renderer?.send(IPC_CHANNELS.NOTIFICATION_LIVE_RECEIVED, notification);
        },
        showDesktop: (notification, options) => {
          if (this.renderer) {
            showLiveDesktopNotification(this.renderer, notification, {
              ...options,
              title: getNativeText("channelIsLive", {
                channel: notification.channelDisplayName,
              }),
            });
          }
        },
        desktopNotificationsSupported: () => Notification.isSupported(),
        now: () => Date.now(),
        intervalMs: LIVE_NOTIFICATION_POLL_INTERVAL_MS,
        maxFollowsBeforeDegraded: { twitch: 250, kick: 250 },
      });
    }
    this.syncPlatformHealthCoverage();
    if (!this.platformHealthCleanup) {
      this.platformHealthCleanup = onPlatformHealthChanged((event) => {
        this.applyPlatformHealthCoverage(event.platform);
      });
    }
    if (!this.twitchEventSubSource) {
      this.twitchEventSubSource = new TwitchLiveEventSubSource({
        getToken: () => storageService.getToken("twitch"),
        getUser: () => storageService.getTwitchUser(),
        getFollows: () => storageService.getActiveFollowsByPlatform("twitch"),
        getClientId: () => TWITCH_APP_CLIENT_ID,
        getEventSubClient: getTwitchEventSubClient,
        onOnline: (observation) => {
          this.service?.observeOnline(observation);
        },
        onOffline: (channel) => {
          this.service?.observeOffline(channel);
        },
        onCoverageDegraded: (issue) => {
          this.service?.reportCoverageDegraded({
            platform: "twitch",
            reason: "eventsub-failed",
            message: issue.message ?? "Twitch EventSub coverage degraded",
            safeContext: {
              sourceReason: issue.reason,
              channelId: issue.channelId ?? null,
            },
          });
          logger.warn("LiveNotifications", "Twitch EventSub coverage degraded", { ...issue });
        },
      });
    }
    void this.service.start().then(() => {
      this.twitchEventSubSource?.sync();
    });
  }

  stop(): void {
    this.service?.stop();
    this.twitchEventSubSource?.close();
    this.twitchEventSubSource = null;
    this.platformHealthCleanup?.();
    this.platformHealthCleanup = null;
    this.renderer = null;
  }

  reconcileSilently(): void {
    this.twitchEventSubSource?.sync();
    void this.service?.reconcileSilently();
  }

  getCoverageStatus(): LiveNotificationCoverageStatus {
    return (
      this.service?.getCoverageStatus() ?? {
        desktop: {
          supported: Notification.isSupported(),
          permission: Notification.isSupported() ? "unknown" : "unsupported",
        },
        platforms: {
          twitch: { status: "normal", issues: [] },
          kick: { status: "normal", issues: [] },
        },
      }
    );
  }

  private getKickLiveSource(): KickLiveNotificationSource {
    if (!this.kickLiveSource) {
      this.kickLiveSource = new KickLiveNotificationSource({
        getPublicStreamBySlug: fetchPublicKickStreamBySlug,
        onOnline: (observation) => {
          this.service?.observeOnline(observation);
        },
        onOffline: (channel) => {
          this.service?.observeOffline(channel);
        },
      });
    }
    return this.kickLiveSource;
  }

  private syncPlatformHealthCoverage(): void {
    this.applyPlatformHealthCoverage("twitch");
    this.applyPlatformHealthCoverage("kick");
  }

  private applyPlatformHealthCoverage(platform: Platform): void {
    const status = getPlatformHealth(platform);
    if (status === "healthy") {
      this.service?.reportCoverageHealthy(platform, "platform-health");
      return;
    }
    const detail = getPlatformStatusPageDetail(platform);
    this.service?.reportCoverageDegraded({
      platform,
      reason: "platform-health",
      message: `${platformLabel(platform)} platform health is ${status}`,
      safeContext: {
        status,
        statusPageSummary: detail?.summary ?? null,
      },
    });
  }
}

export const liveNotificationService = new AppLiveNotificationService();

function channelKey(stream: Pick<UnifiedStream, "platform" | "channelId" | "channelName">): string {
  return liveNotificationChannelKey({
    platform: stream.platform,
    id: stream.channelId,
    username: stream.channelName,
  });
}

function followKey(follow: Pick<LocalFollow, "platform" | "channelId" | "channelName">): string {
  return liveNotificationChannelKey({
    platform: follow.platform,
    id: follow.channelId,
    username: follow.channelName,
  });
}

function normalizedChannelName(channelName: string): string {
  return channelName.toLowerCase().trim();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function platformLabel(platform: Platform): string {
  return platform === "twitch" ? "Twitch" : "Kick";
}
