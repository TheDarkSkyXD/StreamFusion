import type {
  SignedOutCategoryClipsBody,
  SignedOutCategoryStreamsBody,
  SignedOutCategoryVideosBody,
  SignedOutClipTimeRange
} from "@streamfusion/core/relay";

import { cursorFrom, dataFrom, queryParams } from "./twitch-helix-json";
import { toClip, toVideo, topStreamsBody } from "./twitch-helix-mappers";

type TwitchClient = {
  get(path: string): Promise<unknown | null>;
};

export function createTwitchCategoryMedia(client: TwitchClient) {
  return {
    async categoryStreams(input: {
      readonly categoryId: string;
      readonly cursor?: string;
      readonly language?: string;
    }): Promise<SignedOutCategoryStreamsBody | null> {
      const payload = await client.get(
        `/streams?${queryParams({
          first: "20",
          game_id: input.categoryId,
          ...(input.language === undefined ? {} : { language: input.language }),
          ...(input.cursor === undefined ? {} : { after: input.cursor })
        })}`
      );
      if (payload === null) return null;
      const body = topStreamsBody(payload);
      return {
        platform: "twitch",
        streams: body.streams,
        ...(body.cursor === undefined ? {} : { cursor: body.cursor })
      };
    },
    async categoryClips(input: {
      readonly categoryId: string;
      readonly cursor?: string;
      readonly nowEpochMs: number;
      readonly timeRange: SignedOutClipTimeRange;
    }): Promise<SignedOutCategoryClipsBody | null> {
      const window = clipWindow(input.timeRange, input.nowEpochMs);
      const payload = await client.get(
        `/clips?${queryParams({
          first: "20",
          game_id: input.categoryId,
          ...(window === null
            ? {}
            : { ended_at: window.endedAt, started_at: window.startedAt }),
          ...(input.cursor === undefined ? {} : { after: input.cursor })
        })}`
      );
      if (payload === null) return null;
      const cursor = cursorFrom(payload);
      const clips = dataFrom(payload).flatMap((record) => {
        const clip = toClip(record);
        return clip === null ? [] : [clip];
      });
      return cursor === null
        ? { clips, kind: "available", platform: "twitch" }
        : { clips, cursor, kind: "available", platform: "twitch" };
    },
    async categoryVideos(input: {
      readonly categoryId: string;
      readonly cursor?: string;
      readonly sort: "views" | "recent";
    }): Promise<SignedOutCategoryVideosBody | null> {
      const payload = await client.get(
        `/videos?${queryParams({
          first: "20",
          game_id: input.categoryId,
          sort: input.sort === "recent" ? "time" : "views",
          ...(input.cursor === undefined ? {} : { after: input.cursor })
        })}`
      );
      if (payload === null) return null;
      const cursor = cursorFrom(payload);
      const videos = dataFrom(payload).flatMap((record) => {
        const video = toVideo(record);
        return video === null ? [] : [video];
      });
      return cursor === null
        ? { kind: "available", platform: "twitch", videos }
        : { cursor, kind: "available", platform: "twitch", videos };
    }
  };
}

function clipWindow(
  timeRange: SignedOutClipTimeRange,
  nowEpochMs: number
): { readonly endedAt: string; readonly startedAt: string } | null {
  if (timeRange === "all") return null;
  const spanMs =
    timeRange === "day"
      ? 24 * 60 * 60 * 1_000
      : timeRange === "week"
        ? 7 * 24 * 60 * 60 * 1_000
        : 30 * 24 * 60 * 60 * 1_000;
  return {
    endedAt: new Date(nowEpochMs).toISOString(),
    startedAt: new Date(nowEpochMs - spanMs).toISOString()
  };
}
