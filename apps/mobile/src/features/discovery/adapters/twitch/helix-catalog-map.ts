import type { Category, Channel, Stream } from "@streamfusion/core/content";

import { canonicalTimestamp } from "../../utils/helix-media";
import {
  helixTags,
  twitchChannelVerified,
  twitchStreamVerified,
} from "../../utils/catalog-fields";

export function helixStreams(value: unknown): readonly Stream[] {
  return helixRows(value).flatMap((record) => {
    const id = stringField(record, "id");
    if (id === "") return [];
    const startedAt = canonicalTimestamp(stringField(record, "started_at"));
    const categoryId = stringField(record, "game_id");
    const categoryName = stringField(record, "game_name");
    return [
      {
        channelAvatar: "",
        channelDisplayName: stringField(record, "user_name"),
        channelId: stringField(record, "user_id"),
        channelName: stringField(record, "user_login"),
        id,
        isLive: stringField(record, "type") === "live",
        language: stringField(record, "language"),
        platform: "twitch" as const,
        startedAt: startedAt ?? null,
        tags: helixTags(record),
        thumbnailUrl: stringField(record, "thumbnail_url")
          .replaceAll("{width}", "640")
          .replaceAll("{height}", "360"),
        title: stringField(record, "title"),
        viewerCount:
          typeof record.viewer_count === "number" && record.viewer_count >= 0
            ? record.viewer_count
            : 0,
        ...(categoryId === "" ? {} : { categoryId }),
        ...(categoryName === "" ? {} : { categoryName }),
      },
    ];
  });
}

export type HelixUserFlags = {
  readonly isPartner: boolean;
  readonly isVerified: boolean;
};

export function helixUserVerification(
  value: unknown,
): ReadonlyMap<string, HelixUserFlags> {
  const users = new Map<string, HelixUserFlags>();
  for (const record of helixRows(value)) {
    const id = stringField(record, "id");
    if (id === "") continue;
    const type = stringField(record, "broadcaster_type");
    users.set(id, {
      isPartner: twitchStreamVerified(type),
      isVerified: twitchChannelVerified(type),
    });
  }
  return users;
}

export function attachHelixStreamVerification(
  streams: readonly Stream[],
  users: ReadonlyMap<string, HelixUserFlags>,
): readonly Stream[] {
  return streams.map((stream) => {
    if (users.get(stream.channelId)?.isVerified !== true) return stream;
    return { ...stream, channelIsVerified: true };
  });
}

export function attachHelixChannelVerification(
  channels: readonly Channel[],
  users: ReadonlyMap<string, HelixUserFlags>,
): readonly Channel[] {
  return channels.map((channel) => {
    const flags = users.get(channel.id);
    if (flags === undefined) return channel;
    return {
      ...channel,
      isPartner: flags.isPartner,
      isVerified: flags.isVerified,
    };
  });
}

export function helixLiveStreamsFromSearch(value: unknown): readonly Stream[] {
  return helixRows(value).flatMap((record) => {
    if (record.is_live !== true) return [];
    const id = stringField(record, "id");
    const channelName =
      stringField(record, "broadcaster_login") ||
      stringField(record, "user_login");
    if (id === "" || channelName === "") return [];
    return [
      {
        channelAvatar: stringField(record, "thumbnail_url"),
        channelDisplayName:
          stringField(record, "display_name") || channelName,
        channelId: id,
        channelName,
        id: `live:twitch:${id}`,
        isLive: true,
        language: stringField(record, "broadcaster_language"),
        platform: "twitch" as const,
        startedAt: null,
        tags: helixTags(record),
        thumbnailUrl: stringField(record, "thumbnail_url"),
        title: stringField(record, "title"),
        viewerCount: 0,
        ...(stringField(record, "game_id") === ""
          ? {}
          : { categoryId: stringField(record, "game_id") }),
        ...(stringField(record, "game_name") === ""
          ? {}
          : { categoryName: stringField(record, "game_name") }),
      },
    ];
  });
}


export type HelixFollowedChannel = {
  readonly platform: "twitch";
  readonly channelId: string;
  readonly channelLogin: string;
  readonly displayName: string;
  readonly followedAt: string;
};

export function helixFollowedChannels(value: unknown): readonly HelixFollowedChannel[] {
  return helixRows(value).flatMap((record) => {
    const channelId = stringField(record, "broadcaster_id");
    const channelLogin = stringField(record, "broadcaster_login").toLowerCase();
    if (channelId === "" || channelLogin === "") return [];
    const displayName = stringField(record, "broadcaster_name") || channelLogin;
    const followedAt =
      stringField(record, "followed_at") || "1970-01-01T00:00:00.000Z";
    return [
      {
        platform: "twitch" as const,
        channelId,
        channelLogin,
        displayName,
        followedAt,
      },
    ];
  });
}

export function helixCategories(value: unknown): readonly Category[] {
  return helixRows(value).flatMap((record) => {
    const id = stringField(record, "id");
    if (id === "") return [];
    return [
      {
        boxArtUrl: stringField(record, "box_art_url")
          .replaceAll("{width}", "285")
          .replaceAll("{height}", "380"),
        id,
        name: stringField(record, "name"),
        platform: "twitch" as const,
      },
    ];
  });
}

export function helixChannels(value: unknown): readonly Channel[] {
  return helixRows(value).flatMap((record) => {
    const id = stringField(record, "id");
    if (id === "") return [];
    const categoryId = stringField(record, "game_id");
    const categoryName = stringField(record, "game_name");
    return [
      {
        avatarUrl: stringField(record, "thumbnail_url"),
        displayName:
          stringField(record, "display_name") ||
          stringField(record, "broadcaster_login"),
        id,
        isLive: record.is_live === true,
        isPartner: stringField(record, "broadcaster_type") === "partner",
        isVerified: twitchChannelVerified(stringField(record, "broadcaster_type")),
        platform: "twitch" as const,
        username: stringField(record, "broadcaster_login"),
        ...(categoryId === "" ? {} : { categoryId }),
        ...(categoryName === "" ? {} : { categoryName }),
      },
    ];
  });
}

function helixRows(value: unknown): readonly Record<string, unknown>[] {
  if (typeof value !== "object" || value === null || !("data" in value)) {
    return [];
  }
  const data = (value as { data: unknown }).data;
  if (!Array.isArray(data)) return [];
  return data.filter(
    (row): row is Record<string, unknown> =>
      typeof row === "object" && row !== null,
  );
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}
