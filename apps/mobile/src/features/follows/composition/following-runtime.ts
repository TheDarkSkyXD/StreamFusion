import { toSerializedTimestamp } from "@streamfusion/core/content";
import type { Channel, Stream } from "@streamfusion/core/content";
import { parseGuestFollowWrite, type GuestFollow } from "@streamfusion/core/follows";
import type { Platform } from "@streamfusion/core/platform";
import type { FollowedIdentityRef } from "@streamfusion/core/relay";

import type { ActivityItem } from "@streamfusion/core/activity";
import type {
  ActivityRepository,
  DisposableCache,
  GuestFollowRepository,
  LiveNotificationPreferenceStore,
} from "@mobile/features/storage/capabilities/persistence";
import { createGuestLiveAlertReconciler } from "@mobile/features/activity/domain/guest-live-alert-reconciler";
import { unionFollowMembership } from "@mobile/features/activity/domain/union-follow-membership";

import { createRelayFollowedContentReader } from "../adapters/relay/relay-followed-content-reader";
import { createExpoProviderPageOpener } from "../adapters/expo-provider-page";
import type {
  AccountFollowMembershipSource,
  AccountLiveStreamsSource,
} from "../capabilities/account-follow-membership";
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
  readonly activity?: ActivityRepository;
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
  readonly liveNotifications: LiveNotificationPreferenceStore;
  readonly network: () => Promise<"online" | "offline">;
  readonly now?: () => number;
  readonly presentSystemNotification?: (input: {
    readonly item: ActivityItem;
    readonly silent: boolean;
  }) => Promise<void>;
  readonly relayBaseUrl: string;
}): FollowingSession {
  const now = input.now ?? Date.now;
  return bindSession({
    accountFollows: input.accountFollows ?? [],
    accountLiveStreams: input.accountLiveStreams ?? [],
    guestFollows: input.guestFollows,
    liveAlertPrimed: { value: false },
    liveAlertReconciler:
      input.activity === undefined
        ? null
        : createGuestLiveAlertReconciler({
            activity: input.activity,
            now,
            systemNotificationsSupported: true,
            ...(input.presentSystemNotification === undefined
              ? {}
              : {
                  presentSystemNotification: input.presentSystemNotification,
                }),
          }),
    liveCache: createFollowedLiveCache(input.cache),
    liveNotifications: input.liveNotifications,
    now,
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
  readonly accountFollows: readonly AccountFollowMembershipSource[];
  readonly accountLiveStreams: readonly AccountLiveStreamsSource[];
  readonly guestFollows: GuestFollowRepository;
  readonly liveAlertPrimed: { value: boolean };
  readonly liveAlertReconciler: ReturnType<
    typeof createGuestLiveAlertReconciler
  > | null;
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
    listMembership: () => listUnionMembership(deps),
    mutateFollow: (write) => mutateGuestFollow({ ...deps, write }),
    openProviderPage: (target) => deps.pages.open(target),
    readNotifications: () => deps.liveNotifications.read(),
    resolveChannel: (read) => resolveByLogin(deps.reader, read),
    writeNotifications: (value) => deps.liveNotifications.write(value),
  };
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
    if (outcome.kind === "available") follows.push(...outcome.follows);
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
    readonly liveAlertPrimed: { value: boolean };
    readonly liveAlertReconciler: ReturnType<
      typeof createGuestLiveAlertReconciler
    > | null;
    readonly liveCache: LiveCache;
    readonly liveNotifications: LiveNotificationPreferenceStore;
    readonly reader: FollowedReader;
  },
  signal?: AbortSignal,
): Promise<Readonly<Record<Platform, FollowedReadOutcome<Stream>>>> {
  const guestMembership = await deps.guestFollows.list();
  const accountMembership = await readAccountFollows(deps.accountFollows);
  const membership = unionFollowMembership(guestMembership, accountMembership);
  const extra = signal === undefined ? {} : { signal };
  // Twitch account live status uses Helix streams/followed (accountLiveStreams).
  // Kick has no official live-followed API — hydrate Kick via relay using the
  // Guest ∪ Kick-account membership union so Activity go-lives include them.
  const [twitch, kick, accountLive] = await Promise.all([
    hydratePlatform({
      liveCache: deps.liveCache,
      membership: guestMembership,
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
    readAccountLiveStreams(deps.accountLiveStreams),
  ]);
  if (deps.liveAlertReconciler) {
    const fresh =
      twitch.status === "complete" ||
      twitch.status === "partial" ||
      kick.status === "complete" ||
      kick.status === "partial" ||
      accountLive.length > 0;
    if (fresh) {
      const preferences = await deps.liveNotifications.read();
      // First observation after cold start is silent so already-live channels
      // do not flood Activity; subsequent hydrates emit offline→live alerts.
      const silent = !deps.liveAlertPrimed.value;
      deps.liveAlertPrimed.value = true;
      await deps.liveAlertReconciler.observe({
        guestMembership,
        membership,
        preferences,
        silent,
        streams: [...twitch.items, ...kick.items, ...accountLive],
      });
    }
  }
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
