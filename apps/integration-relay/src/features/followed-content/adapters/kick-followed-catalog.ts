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
      return payload === null
        ? null
        : channelsBody(kickChannelsFrom(payload), refs);
    },
    async followedStreams(refs) {
      const resolved = await resolveStreamIds(client, refs);
      if (resolved === null) return null;
      if (resolved.ids.length === 0) {
        return streamsBody([], refs);
      }
      const payload = await client.get(
        `/public/v1/livestreams?${idQuery(resolved.ids)}`
      );
      return payload === null
        ? null
        : streamsBody(kickStreamsFrom(payload), refs);
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
): Promise<{ readonly ids: readonly string[] } | null> {
  const ids = refs.filter((ref) => ref.kind === "id").map((ref) => ref.value);
  const logins = refs
    .filter((ref) => ref.kind === "login")
    .map((ref) => ref.value);
  if (logins.length === 0) return { ids };
  const payload = await client.get(
    `/public/v1/channels?${helixQuery(logins.map((login) => ["slug[]", login] as const))}`
  );
  if (payload === null) return null;
  return {
    ids: [...ids, ...kickChannelsFrom(payload).map((channel) => channel.id)]
  };
}

function channelQuery(refs: readonly FollowedIdentityRef[]): string {
  return helixQuery(
    refs.map((ref) =>
      ref.kind === "id"
        ? (["broadcaster_user_id[]", ref.value] as const)
        : (["slug[]", ref.value] as const)
    )
  );
}

function idQuery(ids: readonly string[]): string {
  return helixQuery(ids.map((id) => ["broadcaster_user_id[]", id] as const));
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
