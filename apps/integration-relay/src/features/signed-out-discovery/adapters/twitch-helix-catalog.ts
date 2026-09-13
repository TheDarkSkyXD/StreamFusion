import type {
  SignedOutCategoryBody,
  SignedOutCategoryClipsBody,
  SignedOutCategoryStreamsBody,
  SignedOutCategoryVideosBody,
  SignedOutTopStreamsBody
} from "@streamfusion/core/relay";

import type {
  AppCredentials,
  DiscoveryCatalog
} from "../capabilities/discovery-catalog";
import { createTwitchCategoryMedia } from "./twitch-helix-category-media";
import { createTwitchChannelReads } from "./twitch-helix-channel";
import { createTwitchClient } from "./twitch-helix-client";
import { streamsFromLiveChannels } from "./live-streams-from-channels";
import { fetchTwitchSearchMedia } from "./twitch-search-media";
import {
  categoriesBody,
  firstCategory,
  searchBody,
  topStreamsBody
} from "./twitch-helix-mappers";
import { queryParams } from "./twitch-helix-json";

export function createTwitchHelixCatalog(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}): DiscoveryCatalog {
  const client = createTwitchClient(input);
  const media = createTwitchCategoryMedia(client);
  const now = input.now ?? Date.now;
  return {
    platform: "twitch",
    async topStreams() {
      const payload = await client.get("/streams?first=20");
      return payload === null ? null : topStreamsBody(payload);
    },
    async categories(read = {}) {
      const payload = await client.get(
        `/games/top?${queryParams({
          first: "20",
          ...(read.cursor === undefined ? {} : { after: read.cursor })
        })}`
      );
      return payload === null ? null : categoriesBody(payload);
    },
    async search({ query }) {
      const [channelsPayload, categoriesPayload] = await Promise.all([
        client.get(`/search/channels?${queryParams({ first: "20", query })}`),
        client.get(`/search/categories?${queryParams({ first: "20", query })}`)
      ]);
      const body = searchBody(channelsPayload, categoriesPayload, query);
      if (body === null) return null;
      const media = await fetchTwitchSearchMedia({
        channels: body.channels,
        get: client.get
      });
      return {
        ...body,
        clips: media.clips,
        streams: streamsFromLiveChannels(body.channels),
        videos: media.videos
      };
    },
    ...createTwitchChannelReads((path) => client.get(path)),
    async category({ categoryId }) {
      const payload = await client.get(
        `/games?${queryParams({ id: categoryId })}`
      );
      const category = payload === null ? null : firstCategory(payload);
      return category === null
        ? null
        : ({ category, platform: "twitch" } satisfies SignedOutCategoryBody);
    },
    categoryStreams(read): Promise<SignedOutCategoryStreamsBody | null> {
      return media.categoryStreams(read);
    },
    categoryClips(read): Promise<SignedOutCategoryClipsBody | null> {
      return media.categoryClips({
        categoryId: read.categoryId,
        nowEpochMs: now(),
        timeRange: read.timeRange,
        ...(read.cursor === undefined ? {} : { cursor: read.cursor })
      });
    },
    categoryVideos(read): Promise<SignedOutCategoryVideosBody | null> {
      return media.categoryVideos(read);
    }
  };
}

export type { SignedOutTopStreamsBody };
