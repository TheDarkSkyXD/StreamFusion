import type {
  SignedOutCategoryClipsBody,
  SignedOutCategoryStreamsBody,
  SignedOutCategoryVideosBody
} from "@streamfusion/core/relay";

import { queryParams } from "./kick-official-json";
import { topStreamsBody } from "./kick-official-mappers";

type KickClient = {
  get(path: string): Promise<unknown | null>;
};

export function createKickCategoryMedia(client: KickClient) {
  return {
    async categoryStreams(input: {
      readonly categoryId: string;
      readonly cursor?: string;
      readonly language?: string;
    }): Promise<SignedOutCategoryStreamsBody | null> {
      const payload = await client.get(
        `/public/v1/livestreams?${queryParams({
          category_id: input.categoryId,
          limit: "20",
          ...(input.language === undefined ? {} : { language: input.language }),
          ...(input.cursor === undefined ? {} : { cursor: input.cursor })
        })}`
      );
      if (payload === null) return null;
      const body = topStreamsBody(payload);
      return {
        platform: "kick",
        streams: body.streams,
        ...(body.cursor === undefined ? {} : { cursor: body.cursor })
      };
    },
    async categoryClips(): Promise<SignedOutCategoryClipsBody> {
      return {
        kind: "unsupported",
        platform: "kick",
        reason: "kick-clips-unsupported"
      };
    },
    async categoryVideos(): Promise<SignedOutCategoryVideosBody> {
      return {
        kind: "unsupported",
        platform: "kick",
        reason: "kick-videos-unsupported"
      };
    }
  };
}
