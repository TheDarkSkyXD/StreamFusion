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
import { createTwitchHelixClient } from "./twitch-helix-client";
import {
  twitchChannelsBody,
  twitchClipsBody,
  twitchStreamsBody,
  twitchVideosBody
} from "./twitch-followed-map";

export function createTwitchFollowedCatalog(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}): FollowedContentCatalog {
  const client = createTwitchHelixClient(input);
  return {
    platform: "twitch",
    async followedStreams(refs) {
      const payload = await client.get(
        `/streams?${identityQuery(refs, "user_id", "user_login")}`
      );
      return payload === null
        ? null
        : streamsBody(twitchStreamsBody(payload), refs);
    },
    async followedChannels(refs) {
      const payload = await client.get(
        `/users?${identityQuery(refs, "id", "login")}`
      );
      return payload === null
        ? null
        : channelsBody(twitchChannelsBody(payload), refs);
    },
    async followedVideos({ channelId, sort }) {
      const helixSort = sort === "views" ? "views" : "time";
      const payload = await client.get(
        `/videos?${helixQuery([
          ["user_id", channelId],
          ["sort", helixSort],
          ["first", "20"]
        ])}`
      );
      if (payload === null) return null;
      const mapped = twitchVideosBody(payload);
      return recordedVideos(channelId, mapped.videos, mapped.cursor);
    },
    async followedClips({ channelId, period, sort }) {
      const payload = await client.get(
        `/clips?${clipQuery(channelId, period, input.now ?? Date.now)}`
      );
      if (payload === null) return null;
      const mapped = twitchClipsBody(payload);
      const clips = [...mapped.clips].toSorted((left, right) =>
        sort === "views"
          ? right.viewCount - left.viewCount
          : right.createdAt.localeCompare(left.createdAt)
      );
      return recordedClips(channelId, clips, mapped.cursor);
    }
  };
}

function identityQuery(
  refs: readonly FollowedIdentityRef[],
  idKey: string,
  loginKey: string
): string {
  return helixQuery(
    refs.map((ref) =>
      ref.kind === "id"
        ? ([idKey, ref.value] as const)
        : ([loginKey, ref.value] as const)
    )
  );
}

function clipQuery(
  channelId: string,
  period: "day" | "week" | "month" | "all",
  now: () => number
): string {
  const params: (readonly [string, string])[] = [
    ["broadcaster_id", channelId],
    ["first", "20"]
  ];
  if (period === "all") return helixQuery(params);
  const ended = new Date(now());
  const started = new Date(ended.getTime() - periodMs(period));
  return helixQuery([
    ...params,
    ["started_at", started.toISOString()],
    ["ended_at", ended.toISOString()]
  ]);
}

function periodMs(period: "day" | "week" | "month"): number {
  if (period === "day") return 86_400_000;
  if (period === "week") return 7 * 86_400_000;
  return 30 * 86_400_000;
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
    platform: "twitch",
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
    platform: "twitch"
  };
}

function recordedVideos(
  channelId: string,
  videos: FollowedVideosBody["videos"],
  cursor: string | null
): FollowedVideosBody {
  const body: FollowedVideosBody = {
    channelId,
    platform: "twitch",
    supported: true,
    videos
  };
  return cursor === null ? body : { ...body, cursor };
}

function recordedClips(
  channelId: string,
  clips: FollowedClipsBody["clips"],
  cursor: string | null
): FollowedClipsBody {
  const body: FollowedClipsBody = {
    channelId,
    clips,
    platform: "twitch",
    supported: true
  };
  return cursor === null ? body : { ...body, cursor };
}
