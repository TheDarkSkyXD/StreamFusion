import type {
  FollowedChannelsBody,
  FollowedClipPeriod,
  FollowedClipsBody,
  FollowedIdentityRef,
  FollowedRecordedSort,
  FollowedStreamsBody,
  FollowedVideosBody
} from "@streamfusion/core/relay";

export type FollowedPlatform = FollowedStreamsBody["platform"];

export type FollowedContentRead =
  | {
      readonly kind: "streams";
      readonly platform: FollowedPlatform;
      readonly refs: readonly FollowedIdentityRef[];
    }
  | {
      readonly kind: "channels";
      readonly platform: FollowedPlatform;
      readonly refs: readonly FollowedIdentityRef[];
    }
  | {
      readonly kind: "videos";
      readonly platform: FollowedPlatform;
      readonly channelId: string;
      readonly sort: FollowedRecordedSort;
    }
  | {
      readonly kind: "clips";
      readonly platform: FollowedPlatform;
      readonly channelId: string;
      readonly sort: FollowedRecordedSort;
      readonly period: FollowedClipPeriod;
    };

export type FollowedContentReadResult =
  | { readonly kind: "streams"; readonly body: FollowedStreamsBody }
  | { readonly kind: "channels"; readonly body: FollowedChannelsBody }
  | { readonly kind: "videos"; readonly body: FollowedVideosBody }
  | { readonly kind: "clips"; readonly body: FollowedClipsBody }
  | { readonly kind: "unavailable" };

export interface FollowedContentCatalog {
  readonly platform: FollowedPlatform;
  followedStreams(
    refs: readonly FollowedIdentityRef[]
  ): Promise<FollowedStreamsBody | null>;
  followedChannels(
    refs: readonly FollowedIdentityRef[]
  ): Promise<FollowedChannelsBody | null>;
  followedVideos(input: {
    readonly channelId: string;
    readonly sort: FollowedRecordedSort;
  }): Promise<FollowedVideosBody | null>;
  followedClips(input: {
    readonly channelId: string;
    readonly period: FollowedClipPeriod;
    readonly sort: FollowedRecordedSort;
  }): Promise<FollowedClipsBody | null>;
}
