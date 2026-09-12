import { toSerializedTimestamp } from "@streamfusion/core/content";
import type { Channel, Stream } from "@streamfusion/core/content";
import { parseGuestFollowWrite, type GuestFollow } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";
import type { FollowedIdentityRef } from "@streamfusion/core/relay";

import type {
  DisposableCache,
  GuestFollowRepository,
  LiveNotificationPreferenceStore,
} from "@mobile/features/storage/capabilities/persistence";

import { createRelayFollowedContentReader } from "../adapters/relay/relay-followed-content-reader";
import { createExpoProviderPageOpener } from "../adapters/expo-provider-page";
import type {
  FollowedReadOutcome,
  FollowingSession,
  FollowMutationResult,
} from "../capabilities/following-session";
import { createFollowedLiveCache } from "../data/followed-live-cache";
import { guestFollowMutation } from "../domain/guest-follow-mutation";
import { identityRefsFor } from "../utils/following-query";

type FollowedReader = ReturnType<typeof createRelayFollowedContentReader>;
type LiveCache = ReturnType<typeof createFollowedLiveCache>;

export function createFollowingRuntime(input: {
  readonly cache: DisposableCache;
  readonly fetch?: typeof globalThis.fetch;
  readonly guestFollows: GuestFollowRepository;
  readonly installation: () => Promise<
    | { readonly kind: "none" }
    | { readonly kind: "ready"; readonly credential: string }
  >;
  readonly liveNotifications: LiveNotificationPreferenceStore;
  readonly network: () => Promise<"online" | "offline">;
  readonly now?: () => number;
  readonly relayBaseUrl: string;
}): FollowingSession {
  return bindSession({
    guestFollows: input.guestFollows,
    liveCache: createFollowedLiveCache(input.cache),
    liveNotifications: input.liveNotifications,
    now: input.now ?? Date.now,
    pages: createExpoProviderPageOpener(),
    reader: createRelayFollowedContentReader({
      baseUrl: input.relayBaseUrl,
      fetch: input.fetch ?? globalThis.fetch,
      installation: input.installation,
      network: input.network,
    }),
  });
}

function bindSession(deps: {
  readonly guestFollows: GuestFollowRepository;
  readonly liveCache: LiveCache;
  readonly liveNotifications: LiveNotificationPreferenceStore;
  readonly now: () => number;
  readonly pages: ReturnType<typeof createExpoProviderPageOpener>;
  readonly reader: FollowedReader;
}): FollowingSession {
  return {
    hydrateLive: (read = {}) => hydrateLive(deps, read.signal),
    hydrateRecorded: (read) =>
      read.kind === "videos"
        ? deps.reader.readVideos(read)
        : deps.reader.readClips({
            channelId: read.channelId,
            platform: read.platform,
            sort: read.sort,
            period: read.period ?? "all",
            ...(read.signal === undefined ? {} : { signal: read.signal }),
          }),
    listMembership: () => deps.guestFollows.list(),
    mutateFollow: (write) => mutateGuestFollow({ ...deps, write }),
    openProviderPage: (target) => deps.pages.open(target),
    readNotifications: () => deps.liveNotifications.read(),
    resolveChannel: (read) => resolveByLogin(deps.reader, read),
    writeNotifications: (value) => deps.liveNotifications.write(value),
  };
}

async function hydrateLive(
  deps: {
    readonly guestFollows: GuestFollowRepository;
    readonly liveCache: LiveCache;
    readonly reader: FollowedReader;
  },
  signal?: AbortSignal,
): Promise<Readonly<Record<Platform, FollowedReadOutcome<Stream>>>> {
  const membership = await deps.guestFollows.list();
  const extra = signal === undefined ? {} : { signal };
  const [twitch, kick] = await Promise.all([
    hydratePlatform({
      liveCache: deps.liveCache,
      membership,
      platform: "twitch",
      reader: deps.reader,
      ...extra,
    }),
    hydratePlatform({
      liveCache: deps.liveCache,
      membership,
      platform: "kick",
      reader: deps.reader,
      ...extra,
    }),
  ]);
  return { kick, twitch };
}

async function mutateGuestFollow(input: {
  readonly guestFollows: GuestFollowRepository;
  readonly now: () => number;
  readonly reader: FollowedReader;
  readonly write: {
    readonly platform: Platform;
    readonly channelId?: string;
    readonly channelLogin?: string;
  };
}): Promise<FollowMutationResult> {
  const membership = await input.guestFollows.list();
  const decision = guestFollowMutation({
    authenticated: false,
    membership,
    platform: input.write.platform,
    ...(input.write.channelId === undefined
      ? {}
      : { channelId: input.write.channelId }),
    ...(input.write.channelLogin === undefined
      ? {}
      : { channelLogin: input.write.channelLogin }),
  });
  if (decision.kind === "rejected") return decision;
  if (decision.kind === "unfollow") {
    return removeFollow(input.guestFollows, decision.follow);
  }
  return addFollow(input);
}

async function addFollow(input: {
  readonly guestFollows: GuestFollowRepository;
  readonly now: () => number;
  readonly reader: FollowedReader;
  readonly write: {
    readonly platform: Platform;
    readonly channelId?: string;
    readonly channelLogin?: string;
  };
}): Promise<FollowMutationResult> {
  const channel = await resolvedChannel(input.reader, input.write);
  if (channel === null) return { kind: "rejected", reason: "unresolved-channel" };
  const follow = parseGuestFollowWrite({
    channelId: channel.id,
    channelLogin: channel.username,
    displayName: channel.displayName,
    followedAt: toSerializedTimestamp(new Date(input.now()).toISOString()),
    platform: input.write.platform,
  });
  if (follow === null) return { kind: "rejected", reason: "invalid" };
  return { follow: await input.guestFollows.upsert(follow), kind: "followed" };
}

async function removeFollow(
  guestFollows: GuestFollowRepository,
  follow: GuestFollow,
): Promise<FollowMutationResult> {
  await guestFollows.remove({
    channelId: follow.channelId,
    platform: follow.platform,
  });
  return {
    channelId: follow.channelId,
    kind: "unfollowed",
    platform: follow.platform,
  };
}

async function resolveByLogin(
  reader: FollowedReader,
  read: {
    readonly platform: Platform;
    readonly channelLogin: string;
    readonly signal?: AbortSignal;
  },
): Promise<Channel | null> {
  const outcome = await reader.readChannels({
    platform: read.platform,
    refs: [{ kind: "login", value: read.channelLogin.trim().toLowerCase() }],
    ...(read.signal === undefined ? {} : { signal: read.signal }),
  });
  return outcome.items[0] ?? null;
}

async function resolvedChannel(
  reader: FollowedReader,
  write: {
    readonly platform: Platform;
    readonly channelId?: string;
    readonly channelLogin?: string;
  },
): Promise<Channel | null> {
  const refs: FollowedIdentityRef[] = [];
  if (write.channelId) refs.push({ kind: "id", value: write.channelId });
  if (write.channelLogin) {
    refs.push({ kind: "login", value: write.channelLogin.trim().toLowerCase() });
  }
  if (refs.length === 0) return null;
  const outcome = await reader.readChannels({
    platform: write.platform,
    refs,
  });
  return outcome.items[0] ?? null;
}

async function hydratePlatform(input: {
  readonly liveCache: LiveCache;
  readonly membership: readonly GuestFollow[];
  readonly platform: Platform;
  readonly reader: FollowedReader;
  readonly signal?: AbortSignal;
}): Promise<FollowedReadOutcome<Stream>> {
  const refs = identityRefsFor(input.membership, input.platform);
  if (refs.length === 0) {
    return {
      items: [],
      missing: [],
      offline: false,
      platform: input.platform,
      retryable: false,
      stale: false,
      status: "complete",
    };
  }
  const outcome = await input.reader.readStreams({
    platform: input.platform,
    refs,
    ...(input.signal === undefined ? {} : { signal: input.signal }),
  });
  if (outcome.status === "complete" || outcome.status === "partial") {
    await input.liveCache.write(input.platform, outcome.items);
    return outcome;
  }
  const cached = await input.liveCache.read(input.platform);
  return cached ?? outcome;
}
