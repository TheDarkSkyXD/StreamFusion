import type Pusher from "pusher-js";

import type { ChatConnectionStatus } from "../../../shared/chat-types";
import {
  RAID_CONTRACT_PROFILES,
  normalizeRaidChannelSlug,
  raidSourcesMatch,
  type KickRaidSource,
  type RaidHandoffEvent,
  type RaidSource,
  type TwitchRaidSource,
} from "../../../shared/raid-handoff-types";
import { canSendPusherFrames, getKickPusher, kickChatService } from "./kick-chat";
import { parseKickRaidNotification } from "./kick-parser";
import { TwitchHermesClient } from "./twitch-hermes-client";

export type RaidHandoffListener = (event: RaidHandoffEvent) => void;

interface RaidWatchEntry {
  source: RaidSource;
  listeners: Set<RaidHandoffListener>;
  releaseTransport: () => void;
}

const watchEntries = new Map<string, RaidWatchEntry>();
const devSessionIds = new Map<string, string>();

export type DevRaidHandoffScenario =
  | {
      phase: "offer";
      platform: "twitch" | "kick";
      sourceChannelSlug: string;
      targetChannelSlug: string;
      targetDisplayName: string;
      targetAvatarUrl?: string;
      count?: number;
      kickDeadlineMs?: number;
    }
  | {
      phase: "go" | "cancel";
      platform: "twitch";
      sourceChannelSlug: string;
    };

/**
 * Acquire one source-scoped outgoing-raid watch and its normalized listener.
 * The returned release is synchronous and idempotent, including while a
 * provider connection is still starting.
 */
export function watchRaidHandoffs(source: RaidSource, listener: RaidHandoffListener): () => void {
  const key = raidSourceKey(source);
  let entry = watchEntries.get(key);
  if (!entry) {
    const listeners = new Set<RaidHandoffListener>();
    entry = {
      source,
      listeners,
      releaseTransport:
        source.platform === "twitch"
          ? startTwitchWatch(source, (event) => publish(event))
          : startKickWatch(source, (event) => publish(event)),
    };
    watchEntries.set(key, entry);
  }
  entry.listeners.add(listener);

  let released = false;
  return () => {
    if (released) return;
    released = true;
    const current = watchEntries.get(key);
    if (!current) return;
    current.listeners.delete(listener);
    if (current.listeners.size > 0) return;
    watchEntries.delete(key);
    current.releaseTransport();
  };
}

export function simulateRaidHandoffForDev(scenario: DevRaidHandoffScenario): void {
  if (!import.meta.env.DEV) return;
  const normalizedSourceSlug = normalizeRaidChannelSlug(scenario.sourceChannelSlug);
  for (const [key, entry] of watchEntries) {
    if (
      entry.source.platform !== scenario.platform ||
      normalizeRaidChannelSlug(entry.source.channelSlug) !== normalizedSourceSlug
    ) {
      continue;
    }

    if (scenario.phase === "offer") {
      const sessionId = `dev-raid:${scenario.platform}:${normalizedSourceSlug}:${Date.now()}`;
      devSessionIds.set(key, sessionId);
      const receivedAt = Date.now();
      const audience =
        scenario.count === undefined
          ? { kind: "unknown" as const }
          : scenario.platform === "twitch"
            ? { kind: "raid-party" as const, count: scenario.count }
            : { kind: "target-viewers" as const, count: scenario.count };
      if (entry.source.platform === "twitch" && scenario.platform === "twitch") {
        publish({
          phase: "offer",
          offer: {
            sessionId,
            platform: "twitch",
            source: entry.source,
            target: {
              platform: "twitch",
              channelSlug: scenario.targetChannelSlug,
              displayName: scenario.targetDisplayName,
              ...(scenario.targetAvatarUrl ? { avatarUrl: scenario.targetAvatarUrl } : {}),
            },
            audience,
            progress: { kind: "waiting" },
            launchAuthority: { kind: "provider-go" },
            receivedAt,
            contract: RAID_CONTRACT_PROFILES.twitch,
          },
        });
      } else if (entry.source.platform === "kick" && scenario.platform === "kick") {
        const deadlineAt = receivedAt + Math.max(250, scenario.kickDeadlineMs ?? 1_500);
        publish({
          phase: "offer",
          offer: {
            sessionId,
            platform: "kick",
            source: entry.source,
            target: {
              platform: "kick",
              channelSlug: scenario.targetChannelSlug,
              displayName: scenario.targetDisplayName,
              ...(scenario.targetAvatarUrl ? { avatarUrl: scenario.targetAvatarUrl } : {}),
            },
            audience,
            progress: {
              kind: "timed",
              startedAt: receivedAt,
              endsAt: deadlineAt,
              provenance: "observed-first-party-client",
            },
            launchAuthority: {
              kind: "deadline",
              deadlineAt,
              provenance: "observed-first-party-client",
            },
            receivedAt,
            contract: RAID_CONTRACT_PROFILES.kick,
          },
        });
      }
      continue;
    }

    const sessionId = devSessionIds.get(key);
    if (!sessionId || entry.source.platform !== "twitch") continue;
    publish({
      phase: scenario.phase,
      source: entry.source,
      sessionId,
      occurredAt: Date.now(),
    });
    devSessionIds.delete(key);
  }
}

function publish(event: RaidHandoffEvent): void {
  const source = event.phase === "offer" ? event.offer.source : event.source;
  const entry = watchEntries.get(raidSourceKey(source));
  if (!entry || !raidSourcesMatch(entry.source, source)) return;
  for (const listener of entry.listeners) listener(event);
}

function startTwitchWatch(source: TwitchRaidSource, publishEvent: RaidHandoffListener): () => void {
  const client = new TwitchHermesClient(source.channelId, {
    subscribePredictions: false,
    raidSource: source,
  });
  let released = false;
  let connected = false;
  let contractBroken = false;

  const handleRaid = (event: RaidHandoffEvent) => {
    if (!released && !contractBroken) publishEvent(event);
  };
  const handleMismatch = () => {
    if (released || contractBroken) return;
    contractBroken = true;
    publishEvent({ phase: "signal-lost", source, occurredAt: Date.now() });
    client.stop();
  };
  const handleState = (state: "connecting" | "connected" | "disconnected") => {
    if (released || contractBroken) return;
    if (state === "connected") {
      connected = true;
      return;
    }
    if (state === "disconnected" && connected) {
      connected = false;
      publishEvent({ phase: "signal-lost", source, occurredAt: Date.now() });
    }
  };

  client.on("raidHandoff", handleRaid);
  client.on("raidContractMismatch", handleMismatch);
  client.on("state", handleState);
  client.start();

  return () => {
    if (released) return;
    released = true;
    client.off("raidHandoff", handleRaid);
    client.off("raidContractMismatch", handleMismatch);
    client.off("state", handleState);
    client.stop();
  };
}

function startKickWatch(source: KickRaidSource, publishEvent: RaidHandoffListener): () => void {
  const eventName = "App\\Events\\ChatMoveToSupportedChannelEvent";
  let released = false;
  let contractBroken = false;
  let activeSessionId: string | null = null;
  let activeTargetSlug: string | null = null;
  let channel: ReturnType<Pusher["subscribe"]> | null = null;
  let subscribedPusher: Pusher | null = null;

  const unbind = () => {
    if (!channel) return;
    channel.unbind(eventName, handleMove);
    if (subscribedPusher && canSendPusherFrames(subscribedPusher)) {
      subscribedPusher.unsubscribe(`channel.${source.broadcasterUserId}`);
    }
    channel = null;
    subscribedPusher = null;
  };

  const handleMove = (raw: unknown) => {
    if (released || contractBroken) return;
    const rawTargetSlug = readKickTargetSlug(raw);
    if (activeSessionId && rawTargetSlug && rawTargetSlug === activeTargetSlug) return;
    const sessionId = `kick:${source.broadcasterUserId}:${Date.now()}`;
    const result = parseKickRaidNotification(eventName, raw, source, Date.now(), sessionId);
    if (result.kind === "ignored") return;
    if (result.kind === "contract-mismatch") {
      contractBroken = true;
      activeSessionId = null;
      activeTargetSlug = null;
      publishEvent({ phase: "signal-lost", source, occurredAt: Date.now() });
      unbind();
      return;
    }
    if (result.event.phase === "offer") {
      activeSessionId = result.event.offer.sessionId;
      activeTargetSlug = normalizeRaidChannelSlug(result.event.offer.target.channelSlug);
    }
    publishEvent(result.event);
  };

  const subscribe = () => {
    if (released || contractBroken || channel) return;
    const pusher = getKickPusher();
    if (!pusher || !canSendPusherFrames(pusher)) return;
    subscribedPusher = pusher;
    channel = pusher.subscribe(`channel.${source.broadcasterUserId}`);
    channel.bind(eventName, handleMove);
  };

  const handleConnectionState = (status: ChatConnectionStatus) => {
    if (released || status.platform !== "kick") return;
    if (status.state === "connected") {
      subscribe();
      return;
    }
    if (status.state === "disconnected" || status.state === "reconnecting") {
      unbind();
      if (activeSessionId) {
        activeSessionId = null;
        activeTargetSlug = null;
        publishEvent({ phase: "signal-lost", source, occurredAt: Date.now() });
      }
    }
  };

  kickChatService.acquire();
  kickChatService.on("connectionStateChange", handleConnectionState);
  void kickChatService
    .connect()
    .then(subscribe)
    .catch(() => {
      if (!released) publishEvent({ phase: "signal-lost", source, occurredAt: Date.now() });
    });

  return () => {
    if (released) return;
    released = true;
    unbind();
    kickChatService.off("connectionStateChange", handleConnectionState);
    void kickChatService.release();
  };
}

function raidSourceKey(source: RaidSource): string {
  const providerId = source.platform === "twitch" ? source.channelId : source.broadcasterUserId;
  return `${source.platform}:${providerId}:${normalizeRaidChannelSlug(source.channelSlug)}`;
}

function readKickTargetSlug(raw: unknown): string | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const hosted = "hosted" in raw ? raw.hosted : null;
  if (typeof hosted !== "object" || hosted === null || Array.isArray(hosted)) return null;
  const slug = "slug" in hosted ? hosted.slug : null;
  return typeof slug === "string" ? normalizeRaidChannelSlug(slug) : null;
}
