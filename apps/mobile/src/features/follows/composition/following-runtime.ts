import { toSerializedTimestamp } from "@streamfusion/core/content";
import type { Channel, Stream } from "@streamfusion/core/content";
import {
  parseGuestFollowWrite,
  type GuestFollow,
} from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";
import type { FollowedIdentityRef } from "@streamfusion/core/relay";

import type {
  DisposableCache,
  GuestFollowRepository,
  LiveNotificationPreferenceStore,
} from "@mobile/features/storage/capabilities/persistence";
import { unionFollowMembership } from "@mobile/features/activity/domain/union-follow-membership";
import type { LiveStreamCatalog } from "@mobile/features/discovery/capabilities/live-stream-catalog";

import { createPlatformFollowedContentReader } from "../adapters/composite/platform-followed-content-reader";
import { createKickGuestFollowedContentReader } from "../adapters/kick/kick-guest-followed-content-reader";
import { createRelayFollowedContentReader } from "../adapters/relay/relay-followed-content-reader";
import { createTwitchGuestFollowedContentReader } from "../adapters/twitch/twitch-guest-followed-content-reader";
import { createAndroidProviderPageOpener } from "../adapters/android-provider-page";
import type {
  AccountFollowMembershipSource,
  AccountLiveStreamsSource,
} from "../capabilities/account-follow-membership";
import type {
  FollowedContentReader,
  FollowedReadOutcome,
  FollowingSession,
  FollowMutationResult,
  LiveHydration,
} from "../capabilities/following-session";

import { createFollowedLiveCache } from "../data/followed-live-cache";
import { guestFollowMutation } from "../domain/guest-follow-mutation";
import { identityRefsFor } from "../utils/following-query";

type FollowedReader = FollowedContentReader;
type LiveCache = ReturnType<typeof createFollowedLiveCache>;

export function createFollowingRuntime(input: {
  /** Signed-in Twitch/Kick follow lists for Activity membership union. */
  readonly accountFollows?: readonly AccountFollowMembershipSource[];
  /** Signed-in live followed streams (e.g. Helix streams/followed). */
  readonly accountLiveStreams?: readonly AccountLiveStreamsSource[];
  readonly cache: DisposableCache;
  readonly fetch?: typeof globalThis.fetch;
  readonly guestFollows: GuestFollowRepository;
  readonly installation: () => Promise<
    | { readonly kind: "none" }
    | { readonly kind: "ready"; readonly credential: string }
  >;
  readonly kickLiveCatalog?: LiveStreamCatalog;
  readonly liveNotifications: LiveNotificationPreferenceStore;
  readonly network: () => Promise<"online" | "offline">;
  readonly now?: () => number;
  readonly onLocalChange?: () => void;
  readonly onLiveHydrated?: (input: LiveHydration) => void;
  readonly relayBaseUrl: string;
}): FollowingSession {
  const now = input.now ?? Date.now;
  return bindSession({
    accountFollows: input.accountFollows ?? [],
    accountLiveStreams: input.accountLiveStreams ?? [],
    guestFollows: input.guestFollows,
    liveCache: createFollowedLiveCache(input.cache),
    liveNotifications: input.liveNotifications,
    now,
    ...(input.onLiveHydrated === undefined
      ? {}
      : { onLiveHydrated: input.onLiveHydrated }),
    ...(input.onLocalChange === undefined
      ? {}
      : { onLocalChange: input.onLocalChange }),
    pages: createAndroidProviderPageOpener(),
    reader: createPlatformFollowedContentReader({
      relay: createRelayFollowedContentReader({
        baseUrl: input.relayBaseUrl,
        fetch: input.fetch ?? globalThis.fetch,
        installation: input.installation,
        network: input.network,
      }),
      twitchGuest: createTwitchGuestFollowedContentReader({
        fetch: input.fetch ?? globalThis.fetch,
      }),
      ...(input.kickLiveCatalog === undefined
        ? {}
        : {
            kickGuest: createKickGuestFollowedContentReader({
              fetch: input.fetch ?? globalThis.fetch,
              liveCatalog: input.kickLiveCatalog,
            }),
          }),
    }),
  });
}

function bindSession(deps: {
  readonly accountFollows: readonly AccountFollowMembershipSource[];
  readonly accountLiveStreams: readonly AccountLiveStreamsSource[];
  readonly guestFollows: GuestFollowRepository;
  readonly liveCache: LiveCache;
  readonly liveNotifications: LiveNotificationPreferenceStore;
  readonly now: () => number;
  readonly onLocalChange?: () => void;
  readonly onLiveHydrated?: (input: LiveHydration) => void;
  readonly pages: ReturnType<typeof createAndroidProviderPageOpener>;
  readonly reader: FollowedReader;
}): FollowingSession {
  return {
    hydrateLive: (read = {}) => hydrateLive(deps, read.signal),
    hydrateRecorded: (read) => {
      const login =
        read.channelLogin === undefined
          ? {}
          : { channelLogin: read.channelLogin };
      const signal = read.signal === undefined ? {} : { signal: read.signal };
      return read.kind === "videos"
        ? deps.reader.readVideos({
            channelId: read.channelId,
            platform: read.platform,
            sort: read.sort,
            ...login,
            ...signal,
          })
        : deps.reader.readClips({
            channelId: read.channelId,
            platform: read.platform,
            sort: read.sort,
            period: read.period ?? "all",
            ...login,
            ...signal,
          });
    },
    listMembership: () => listUnionMembership(deps),
    listGuestMembership: () => deps.guestFollows.list(),
    async mutateFollow(write) {
      const result = await mutateGuestFollow({ ...deps, write });
      if (result.kind !== "rejected") deps.onLocalChange?.();
      return result;
    },
    async removeGuestFollow(identity) {
      const result = await removeGuestFollow(deps.guestFollows, identity);
      if (result.kind !== "rejected") deps.onLocalChange?.();
      return result;
    },
    openProviderPage: (target) => deps.pages.open(target),
    readNotifications: () => deps.liveNotifications.read(),
    resolveChannel: (read) => resolveByLogin(deps.reader, read),
    async writeNotifications(value) {
      const preferences = await deps.liveNotifications.write(value);
      deps.onLocalChange?.();
      return preferences;
    },
  };
}

async function removeGuestFollow(
  guestFollows: GuestFollowRepository,
  identity: { readonly platform: Platform; readonly channelId: string },
): Promise<FollowMutationResult> {
  const guest = (await guestFollows.list()).find(
    (follow) =>
      follow.platform === identity.platform &&
      follow.channelId === identity.channelId,
  );
  return guest === undefined
    ? { kind: "rejected", reason: "guest-only-scope" }
    : removeFollow(guestFollows, guest);
}

async function listUnionMembership(deps: {
  readonly accountFollows: readonly AccountFollowMembershipSource[];
  readonly guestFollows: GuestFollowRepository;
}): Promise<readonly GuestFollow[]> {
  const guest = await deps.guestFollows.list();
  const account = await readAccountFollows(deps.accountFollows);
  return unionFollowMembership(guest, account);
}

async function readAccountFollows(
  sources: readonly AccountFollowMembershipSource[],
): Promise<readonly GuestFollow[]> {
  if (sources.length === 0) return [];
  const outcomes = await Promise.all(sources.map((source) => source.read()));
  const follows: GuestFollow[] = [];
  for (const outcome of outcomes) {
    if (outcome.kind !== "unavailable") follows.push(...outcome.follows);
  }
  return follows;
}

async function readAccountLiveStreams(
  sources: readonly AccountLiveStreamsSource[],
): Promise<readonly Stream[]> {
  if (sources.length === 0) return [];
  const pages = await Promise.all(sources.map((source) => source.read()));
  return pages.flat();
}

async function hydrateLive(
  deps: {
    readonly accountFollows: readonly AccountFollowMembershipSource[];
    readonly accountLiveStreams: readonly AccountLiveStreamsSource[];
    readonly guestFollows: GuestFollowRepository;
    readonly liveCache: LiveCache;
    readonly liveNotifications: LiveNotificationPreferenceStore;
    readonly reader: FollowedReader;
    readonly now: () => number;
    readonly onLiveHydrated?: (input: LiveHydration) => void;
  },
  signal?: AbortSignal,
): Promise<Readonly<Record<Platform, FollowedReadOutcome<Stream>>>> {
  const guestMembership = await deps.guestFollows.list();
  const accountMembership = await readAccountFollows(deps.accountFollows);
  const membership = unionFollowMembership(guestMembership, accountMembership);
  const extra = signal === undefined ? {} : { signal };
  const twitchObservedAtMs = deps.now();
  const twitchRead = hydratePlatform({
    liveCache: deps.liveCache,
    membership: guestMembership,
    platform: "twitch",
    reader: deps.reader,
    ...extra,
  });
  const kickObservedAtMs = deps.now();
  const kickRead = hydratePlatform({
    liveCache: deps.liveCache,
    membership,
    platform: "kick",
    reader: deps.reader,
    ...extra,
  });
  const accountObservedAtMs = deps.now();
  const [twitch, kick, accountLive] = await Promise.all([
    twitchRead,
    kickRead,
    readAccountLiveStreams(deps.accountLiveStreams),
  ]);
  deps.onLiveHydrated?.({
    membership,
    outcomes: { kick, twitch },
    accountLive,
    observedAtMs: {
      twitch: twitchObservedAtMs,
      kick: kickObservedAtMs,
      account: accountObservedAtMs,
    },
  });
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
    readonly displayName?: string;
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
    readonly displayName?: string;
  };
}): Promise<FollowMutationResult> {
  const known = guestFollowFromKnownIdentity(input.write, input.now);
  if (known !== null) {
    return { follow: await input.guestFollows.upsert(known), kind: "followed" };
  }
  const channel = await resolvedChannel(input.reader, input.write);
  if (channel === null)
    return { kind: "rejected", reason: "unresolved-channel" };
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

function guestFollowFromKnownIdentity(
  write: {
    readonly platform: Platform;
    readonly channelId?: string;
    readonly channelLogin?: string;
    readonly displayName?: string;
  },
  now: () => number,
): GuestFollow | null {
  const channelId = write.channelId?.trim();
  const channelLogin = write.channelLogin?.trim().toLowerCase();
  if (!channelId || !channelLogin) return null;
  const displayName = write.displayName?.trim() || channelLogin;
  return parseGuestFollowWrite({
    channelId,
    channelLogin,
    displayName,
    followedAt: toSerializedTimestamp(new Date(now()).toISOString()),
    platform: write.platform,
  });
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
    refs.push({
      kind: "login",
      value: write.channelLogin.trim().toLowerCase(),
    });
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
