export const PLATFORMS = ["twitch", "kick"] as const;

export type Platform = (typeof PLATFORMS)[number];

export type ChannelRef =
  | { readonly kind: "slug"; readonly value: string }
  | { readonly kind: "id"; readonly value: string };

export interface PlatformIdentity {
  readonly platform: Platform;
  readonly id: string;
}

export interface ChannelIdentity extends PlatformIdentity {
  readonly username: string;
}

export interface StreamChannelIdentity {
  readonly platform: Platform;
  readonly channelId: string;
  readonly channelName: string;
}

export type StableIdentityKey = `${Platform}-${string}`;

function identityKey(platform: Platform, value: string): StableIdentityKey {
  return `${platform}-${value}`;
}

export function getChannelKey(channel: PlatformIdentity): StableIdentityKey {
  return identityKey(channel.platform, channel.id);
}

export function getStreamKey(
  stream: Pick<StreamChannelIdentity, "platform" | "channelId">,
): StableIdentityKey {
  return identityKey(stream.platform, stream.channelId);
}

export function getStreamElementKey(
  stream: PlatformIdentity,
): StableIdentityKey {
  return identityKey(stream.platform, stream.id);
}

export function getChannelNameKey(
  platform: Platform,
  username: string,
): StableIdentityKey {
  return identityKey(platform, username.toLowerCase());
}

export function channelsMatch(
  first: ChannelIdentity,
  second: ChannelIdentity,
): boolean {
  if (first.platform !== second.platform) return false;
  if (first.id && second.id && first.id === second.id) return true;
  return Boolean(
    first.username &&
    second.username &&
    first.username.toLowerCase() === second.username.toLowerCase(),
  );
}

export function streamsMatchChannelIdentity(
  first: StreamChannelIdentity,
  second: StreamChannelIdentity,
): boolean {
  if (first.platform !== second.platform) return false;
  if (
    first.channelId &&
    second.channelId &&
    first.channelId === second.channelId
  ) {
    return true;
  }
  return Boolean(
    first.channelName &&
    second.channelName &&
    first.channelName.toLowerCase() === second.channelName.toLowerCase(),
  );
}
