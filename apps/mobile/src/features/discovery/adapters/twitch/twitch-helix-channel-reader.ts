import type { Clip, Video } from "@streamfusion/core/content";
import type { ChannelIdentity } from "@streamfusion/core/platform";

import type {
  ChannelPageOutcome,
  PlatformReadOutcome,
} from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";
import {
  helixRows,
  identifierField,
} from "../../utils/helix-media";
import { createTwitchGqlGuestReader } from "./twitch-gql-guest";
import { createTwitchGqlGuestMediaReader } from "./twitch-gql-guest-media";
import {
  failedHelixCollection,
  failedHelixPage,
  toHelixChannel,
  toHelixClip,
  toHelixLive,
  toHelixVideo,
} from "./twitch-helix-channel-map";

const HELIX = "https://api.twitch.tv/helix";

export function createTwitchHelixChannelReader(input: {
  readonly clientId: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
}) {
  const guest = createTwitchGqlGuestReader({ fetch: input.fetch });
  const guestMedia = createTwitchGqlGuestMediaReader({ fetch: input.fetch });
  return {
    async getChannel(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<ChannelPageOutcome> {
      if ((await input.readAccessToken()) === null) {
        return guest.getChannel({
          login: read.channel.username || read.channel.id,
          ...signalProp(read.signal),
        });
      }
      const user = await helixUser(input, read.channel, read.signal);
      if (user.kind === "failed") return failedHelixPage(user.code);
      const userId = identifierField(user.row, "id");
      const [channelPayload, streamPayload] = await Promise.all([
        helixJson(input, `/channels?broadcaster_id=${encodeURIComponent(userId)}`, read.signal),
        helixJson(input, `/streams?user_id=${encodeURIComponent(userId)}`, read.signal),
      ]);
      if (channelPayload.kind === "failed") return failedHelixPage(channelPayload.code);
      if (streamPayload.kind === "failed") return failedHelixPage(streamPayload.code);
      const channelRow = helixRows(channelPayload.value).at(0) ?? {};
      const liveRow = helixRows(streamPayload.value).at(0);
      const channel = toHelixChannel(user.row, channelRow, liveRow !== undefined);
      return {
        cache: { kind: "miss" },
        channel,
        live: liveRow === undefined ? null : toHelixLive(liveRow, channel),
        path: { kind: "direct", platform: "twitch" },
        platform: "twitch",
        status: "complete",
      };
    },
    async getChannelVideos(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Video>> {
      if ((await input.readAccessToken()) === null) {
        return guestMedia.getChannelVideos({
          login: read.channel.username || read.channel.id,
          ...signalProp(read.signal),
        });
      }
      return helixMedia(input, read, "/videos", "user_id", toHelixVideo);
    },
    async getChannelClips(read: {
      readonly channel: ChannelIdentity;
      readonly signal?: AbortSignal;
    }): Promise<PlatformReadOutcome<Clip>> {
      if ((await input.readAccessToken()) === null) {
        return guestMedia.getChannelClips({
          login: read.channel.username || read.channel.id,
          ...signalProp(read.signal),
        });
      }
      return helixMedia(input, read, "/clips", "broadcaster_id", toHelixClip);
    },
  };
}

async function helixMedia<T>(
  input: HelixInput,
  read: { readonly channel: ChannelIdentity; readonly signal?: AbortSignal },
  path: "/videos" | "/clips",
  idParam: "user_id" | "broadcaster_id",
  map: (row: Record<string, unknown>, user: Record<string, unknown>) => T,
): Promise<PlatformReadOutcome<T>> {
  const user = await helixUser(input, read.channel, read.signal);
  if (user.kind === "failed") return failedHelixCollection(user.code);
  const payload = await helixJson(
    input,
    `${path}?${idParam}=${encodeURIComponent(identifierField(user.row, "id"))}&first=20`,
    read.signal,
  );
  if (payload.kind === "failed") return failedHelixCollection(payload.code);
  return {
    cache: { kind: "miss" },
    items: helixRows(payload.value).map((row) => map(row, user.row)),
    path: { kind: "direct", platform: "twitch" },
    platform: "twitch",
    status: "complete",
  };
}

async function helixUser(
  input: HelixInput,
  channel: ChannelIdentity,
  signal?: AbortSignal,
): Promise<
  | { readonly kind: "ready"; readonly row: Record<string, unknown> }
  | { readonly kind: "failed"; readonly code: string }
> {
  const query =
    channel.id !== ""
      ? `id=${encodeURIComponent(channel.id)}`
      : `login=${encodeURIComponent(channel.username)}`;
  const payload = await helixJson(input, `/users?${query}`, signal);
  if (payload.kind === "failed") return payload;
  const row = helixRows(payload.value).at(0);
  return row === undefined
    ? { code: "twitch-failed", kind: "failed" }
    : { kind: "ready", row };
}

async function helixJson(
  input: HelixInput,
  path: string,
  signal?: AbortSignal,
): Promise<
  | { readonly kind: "ready"; readonly value: unknown }
  | { readonly kind: "failed"; readonly code: string }
> {
  if (signal?.aborted) return { code: "cancelled", kind: "failed" };
  const accessToken = await input.readAccessToken();
  if (accessToken === null || input.clientId === null) {
    return { code: "signed-out-login-required", kind: "failed" };
  }
  try {
    const response = await input.fetch(
      `${HELIX}${path}`,
      requestInit(
        {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": input.clientId,
        },
        signal,
      ),
    );
    if (!response.ok) {
      return {
        code: response.status === 401 ? "auth-lost" : "twitch-failed",
        kind: "failed",
      };
    }
    return { kind: "ready", value: await response.json() };
  } catch {
    return { code: signal?.aborted ? "cancelled" : "twitch-failed", kind: "failed" };
  }
}

function signalProp(
  signal?: AbortSignal,
): { readonly signal: AbortSignal } | Record<string, never> {
  return signal === undefined ? {} : { signal };
}

type HelixInput = {
  readonly clientId: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
};
