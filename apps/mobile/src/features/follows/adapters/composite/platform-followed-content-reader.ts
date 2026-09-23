import type { Platform } from "@streamfusion/core/platform";

import type { FollowedContentReader } from "../../capabilities/following-session";

/**
 * Twitch Guest Follows use public GQL (desktop parity / Expo Go).
 * Kick and other platforms stay on the relay path.
 */
export function createPlatformFollowedContentReader(input: {
  readonly relay: FollowedContentReader;
  readonly twitchGuest: FollowedContentReader;
}): FollowedContentReader {
  return {
    readStreams: (read) => readerFor(input, read.platform).readStreams(read),
    readChannels: (read) => readerFor(input, read.platform).readChannels(read),
    readVideos: (read) => readerFor(input, read.platform).readVideos(read),
    readClips: (read) => readerFor(input, read.platform).readClips(read),
  };
}

function readerFor(
  input: {
    readonly relay: FollowedContentReader;
    readonly twitchGuest: FollowedContentReader;
  },
  platform: Platform,
): FollowedContentReader {
  return platform === "twitch" ? input.twitchGuest : input.relay;
}
