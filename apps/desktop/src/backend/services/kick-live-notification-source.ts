import type { UnifiedStream } from "@shared/platform-types";
import type { LocalFollow } from "@shared/auth-types";

import type { LiveNotificationObservation } from "./live-notification-service";

export type KickRelayLiveEvent =
  | {
      type: "online";
      channelId: string;
      channelName: string;
      channelDisplayName: string;
      channelAvatar?: string | null;
      title: string;
    }
  | {
      type: "offline";
      channelId: string;
      channelName: string;
    };

export interface KickLiveNotificationSourceDeps {
  getPublicStreamBySlug: (
    slug: string,
    staggerOffsetMs?: number,
    signal?: AbortSignal
  ) => Promise<UnifiedStream | null>;
  maxConcurrency?: number;
  staggerStepMs?: number;
  onOnline?: (observation: LiveNotificationObservation) => void;
  onOffline?: (
    channel: Pick<LiveNotificationObservation, "platform" | "channelId" | "channelName">
  ) => void;
}

export class KickLiveNotificationSource {
  private readonly maxConcurrency: number;
  private readonly staggerStepMs: number;
  private readonly lastLiveBySlug = new Map<string, UnifiedStream>();

  constructor(private readonly deps: KickLiveNotificationSourceDeps) {
    this.maxConcurrency = deps.maxConcurrency ?? 3;
    this.staggerStepMs = deps.staggerStepMs ?? 500;
  }

  async poll(follows: LocalFollow[], signal?: AbortSignal): Promise<UnifiedStream[]> {
    const kickFollows = dedupeFollowsBySlug(
      follows.filter((follow) => follow.platform === "kick" && follow.channelName.trim() !== "")
    );
    if (kickFollows.length === 0) return [];

    const results: UnifiedStream[] = [];
    let nextIndex = 0;
    const workerCount = Math.min(this.maxConcurrency, kickFollows.length);

    await Promise.all(
      Array.from({ length: workerCount }, async () => {
        while (nextIndex < kickFollows.length) {
          const index = nextIndex;
          nextIndex += 1;
          const follow = kickFollows[index];
          if (!follow) continue;
          const slug = normalizeSlug(follow.channelName);
          const stream = await this.pollFollow(follow, index, signal);
          if (stream) {
            results.push(stream);
            this.lastLiveBySlug.set(slug, stream);
          } else {
            this.lastLiveBySlug.delete(slug);
          }
        }
      })
    );

    return results;
  }

  dispatchRelayEvent(event: KickRelayLiveEvent): void {
    if (event.type === "offline") {
      this.deps.onOffline?.({
        platform: "kick",
        channelId: event.channelId,
        channelName: event.channelName,
      });
      return;
    }

    this.deps.onOnline?.({
      platform: "kick",
      channelId: event.channelId,
      channelName: event.channelName,
      channelDisplayName: event.channelDisplayName,
      channelAvatar: event.channelAvatar,
      title: event.title,
    });
  }

  private async pollFollow(
    follow: LocalFollow,
    index: number,
    signal: AbortSignal | undefined
  ): Promise<UnifiedStream | null> {
    const slug = normalizeSlug(follow.channelName);
    try {
      return await this.deps.getPublicStreamBySlug(
        follow.channelName,
        index * this.staggerStepMs,
        signal
      );
    } catch {
      return this.lastLiveBySlug.get(slug) ?? null;
    }
  }
}

function dedupeFollowsBySlug(follows: LocalFollow[]): LocalFollow[] {
  const seen = new Set<string>();
  const deduped: LocalFollow[] = [];
  for (const follow of follows) {
    const slug = normalizeSlug(follow.channelName);
    if (seen.has(slug)) continue;
    seen.add(slug);
    deduped.push(follow);
  }
  return deduped;
}

function normalizeSlug(slug: string): string {
  return slug.toLowerCase().trim();
}
