import type {
  FollowedChannelsBody,
  FollowedClipsBody,
  FollowedIdentityRef,
  FollowedStreamsBody,
  FollowedVideosBody
} from "@streamfusion/core/relay";

import type { AppCredentials } from "../../signed-out-discovery/capabilities/discovery-catalog";
import type { FollowedContentCatalog } from "../capabilities/followed-content-catalog";
import { missingIdentityRefs } from "../utils/missing-identity-refs";
import { helixQuery } from "../utils/provider-json";
import { createKickFollowedClient } from "./kick-followed-client";
import { kickChannelsFrom, kickStreamsFrom } from "./kick-followed-map";

export function createKickFollowedCatalog(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}): FollowedContentCatalog {
  const client = createKickFollowedClient(input);
  return {
    platform: "kick",
    async followedChannels(refs) {
      const payload = await client.get(
        `/public/v1/channels?${channelQuery(refs)}`
      );
      const rows = strictRows(payload);
      if (rows === null) return null;
      const channels = kickChannelsFrom(payload);
      return channels.length === rows.length
        ? channelsBody(channels, refs)
        : null;
    },
    async followedStreams(refs) {
      const resolved = await resolveStreamIds(client, refs);
      if (resolved === null) return null;
      if (resolved.ids.length === 0) {
        return {
          ...streamsBody([], refs),
          unavailableRefs: resolved.unavailableRefs
        };
      }
      const payload = await client.get(
        `/public/v1/livestreams?${idQuery(resolved.ids)}`
      );
      const rows = strictRows(payload);
      if (rows === null) return null;
      const streams = kickStreamsFrom(payload);
      return streams.length === rows.length &&
        streams.every((stream) => stream.startedAt !== null && stream.isLive)
        ? {
            ...streamsBody(streams, refs),
            unavailableRefs: resolved.unavailableRefs
          }
        : null;
    },
    async followedVideos({ channelId }) {
      return unsupportedVideos(channelId);
    },
    async followedClips({ channelId }) {
      return unsupportedClips(channelId);
    }
  };
}

async function resolveStreamIds(
  client: ReturnType<typeof createKickFollowedClient>,
  refs: readonly FollowedIdentityRef[]
): Promise<{
  readonly ids: readonly string[];
  readonly unavailableRefs: readonly FollowedIdentityRef[];
} | null> {
  const ids = refs.filter((ref) => ref.kind === "id").map((ref) => ref.value);
  const logins = refs.filter((ref) => ref.kind === "login");
  if (logins.length === 0) return { ids, unavailableRefs: [] };
  const payload = await client.get(
    `/public/v1/channels?${helixQuery(logins.map((login) => ["slug", login.value] as const))}`
  );
  const rows = strictRows(payload);
  if (rows === null) return null;
  const channels = kickChannelsFrom(payload);
  if (channels.length !== rows.length) return null;
  const requestedLogins = new Set(
    logins.map((login) => login.value.toLowerCase())
  );
  const matchedChannels = channels.filter((channel) =>
    requestedLogins.has(channel.username.toLowerCase())
  );
  const resolvedLogins = new Set(
    matchedChannels.map((channel) => channel.username.toLowerCase())
  );
  return {
    ids: [...ids, ...matchedChannels.map((channel) => channel.id)],
    unavailableRefs: logins.filter(
      (login) => !resolvedLogins.has(login.value.toLowerCase())
    )
  };
}

function channelQuery(refs: readonly FollowedIdentityRef[]): string {
  return helixQuery(
    refs.map((ref) =>
      ref.kind === "id"
        ? (["broadcaster_user_id", ref.value] as const)
        : (["slug", ref.value] as const)
    )
  );
}

function idQuery(ids: readonly string[]): string {
  return helixQuery([
    ["limit", "50"],
    ...ids.map((id) => ["broadcaster_user_id", id] as const)
  ]);
}

function strictRows(payload: unknown): readonly unknown[] | null {
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload) ||
    !("data" in payload)
  )
    return null;
  const rows = payload.data;
  return Array.isArray(rows) &&
    rows.every(
      (row) => typeof row === "object" && row !== null && !Array.isArray(row)
    )
    ? rows
    : null;
}

function streamsBody(
  streams: FollowedStreamsBody["streams"],
  refs: readonly FollowedIdentityRef[]
): FollowedStreamsBody {
  return {
    missing: missingIdentityRefs({
      matchedIds: new Set(streams.map((stream) => stream.channelId)),
      matchedLogins: new Set(
        streams.map((stream) => stream.channelName.toLowerCase())
      ),
      refs
    }),
    platform: "kick",
    streams
  };
}

function channelsBody(
  channels: FollowedChannelsBody["channels"],
  refs: readonly FollowedIdentityRef[]
): FollowedChannelsBody {
  return {
    channels,
    missing: missingIdentityRefs({
      matchedIds: new Set(channels.map((channel) => channel.id)),
      matchedLogins: new Set(
        channels.map((channel) => channel.username.toLowerCase())
      ),
      refs
    }),
    platform: "kick"
  };
}

function unsupportedVideos(channelId: string): FollowedVideosBody {
  return {
    channelId,
    platform: "kick",
    supported: false,
    videos: []
  };
}

function unsupportedClips(channelId: string): FollowedClipsBody {
  return {
    channelId,
    clips: [],
    platform: "kick",
    supported: false
  };
}
