import type {
  SignedOutCategoryBody,
  SignedOutCategoryClipsBody,
  SignedOutCategoryStreamsBody,
  SignedOutCategoryVideosBody
} from "@streamfusion/core/relay";

import type {
  AppCredentials,
  DiscoveryCatalog
} from "../capabilities/discovery-catalog";
import { createKickCategoryMedia } from "./kick-official-category-media";
import { createKickClient } from "./kick-official-client";
import {
  categoriesBody,
  firstCategory,
  searchBody,
  topStreamsBody
} from "./kick-official-mappers";
import { queryParams } from "./kick-official-json";

export function createKickOfficialCatalog(input: {
  readonly credentials: AppCredentials | null;
  readonly fetch: typeof globalThis.fetch;
  readonly now?: () => number;
}): DiscoveryCatalog {
  const client = createKickClient(input);
  const media = createKickCategoryMedia(client);
  return {
    platform: "kick",
    async topStreams() {
      const payload = await client.get("/public/v1/livestreams?limit=20");
      return payload === null ? null : topStreamsBody(payload);
    },
    async categories(read = {}) {
      const payload = await client.get(
        `/public/v2/categories?${queryParams({
          limit: "20",
          ...(read.cursor === undefined ? {} : { after: read.cursor })
        })}`
      );
      return payload === null ? null : categoriesBody(payload);
    },
    async search({ query }) {
      const [channels, categories] = await Promise.all([
        client.get(`/public/v1/channels?${queryParams({ "slug[]": query })}`),
        client.get(`/public/v1/categories?${queryParams({ q: query })}`)
      ]);
      return searchBody(channels, categories, query);
    },
    async category({ categoryId }) {
      const payload = await client.get(
        `/public/v2/categories?${queryParams({ id: categoryId })}`
      );
      const category = payload === null ? null : firstCategory(payload);
      return category === null
        ? null
        : ({ category, platform: "kick" } satisfies SignedOutCategoryBody);
    },
    categoryStreams(read): Promise<SignedOutCategoryStreamsBody | null> {
      return media.categoryStreams(read);
    },
    categoryClips(): Promise<SignedOutCategoryClipsBody | null> {
      return media.categoryClips();
    },
    categoryVideos(): Promise<SignedOutCategoryVideosBody | null> {
      return media.categoryVideos();
    }
  };
}
