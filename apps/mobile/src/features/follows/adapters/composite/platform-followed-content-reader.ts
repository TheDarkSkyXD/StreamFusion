import type { Platform } from "@streamfusion/core/platform";

import type { FollowedContentReader } from "../../capabilities/following-session";

export function createPlatformFollowedContentReader(input: {
  readonly relay: FollowedContentReader;
  readonly twitchGuest: FollowedContentReader;
  readonly kickGuest?: FollowedContentReader;
}): FollowedContentReader {
  return {
    readStreams: async (read) => {
      const outcome = await readerFor(input, read.platform).readStreams(read);
      return input.kickGuest &&
        read.platform === "kick" &&
        outcome.status === "failed" &&
        !read.signal?.aborted
        ? input.relay.readStreams(read)
        : outcome;
    },
    readChannels: async (read) => {
      const outcome = await readerFor(input, read.platform).readChannels(read);
      return input.kickGuest &&
        read.platform === "kick" &&
        outcome.status === "failed" &&
        !read.signal?.aborted
        ? input.relay.readChannels(read)
        : outcome;
    },
    readVideos: async (read) => {
      const outcome = await readerFor(input, read.platform).readVideos(read);
      return input.kickGuest &&
        read.platform === "kick" &&
        outcome.failed &&
        !read.signal?.aborted
        ? input.relay.readVideos(read)
        : outcome;
    },
    readClips: (read) =>
      read.platform === "kick"
        ? input.relay.readClips(read)
        : readerFor(input, read.platform).readClips(read),
  };
}

function readerFor(
  input: {
    readonly relay: FollowedContentReader;
    readonly twitchGuest: FollowedContentReader;
    readonly kickGuest?: FollowedContentReader;
  },
  platform: Platform,
): FollowedContentReader {
  return platform === "twitch"
    ? input.twitchGuest
    : (input.kickGuest ?? input.relay);
}
