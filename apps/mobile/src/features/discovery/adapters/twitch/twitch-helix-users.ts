import type { Channel, Stream } from "@streamfusion/core/content";

import type { PlatformReadOutcome } from "../../capabilities/platform-reads";
import { requestInit } from "../../utils/optional";

import {
  attachHelixChannelVerification,
  attachHelixStreamVerification,
  helixChannels,
  helixLiveStreamsFromSearch,
  helixUserVerification,
  type HelixUserFlags,
} from "./helix-catalog-map";

const HELIX = "https://api.twitch.tv/helix";

type HelixAuth = {
  readonly clientId: string | null;
  readonly fetch: typeof globalThis.fetch;
  readonly readAccessToken: () => Promise<string | null>;
};

export async function completeHelixStreams(
  outcome: PlatformReadOutcome<Stream>,
  input: HelixAuth & { readonly signal?: AbortSignal },
): Promise<PlatformReadOutcome<Stream>> {
  if (outcome.status !== "complete") return outcome;
  const users = await fetchHelixUserVerification({
    ...input,
    ids: uniqueIds(outcome.items.map((stream) => stream.channelId)),
  });
  return {
    ...outcome,
    items: attachHelixStreamVerification(outcome.items, users),
  };
}

export async function completeHelixSearchCatalog(
  input: HelixAuth & {
    readonly payload: unknown;
    readonly signal?: AbortSignal;
  },
): Promise<{
  readonly channels: readonly Channel[];
  readonly streams: readonly Stream[];
}> {
  const channels = helixChannels(input.payload);
  const streams = helixLiveStreamsFromSearch(input.payload);
  const users = await fetchHelixUserVerification({
    ...input,
    ids: uniqueIds([
      ...channels.map((channel) => channel.id),
      ...streams.map((stream) => stream.channelId),
    ]),
  });
  return {
    channels: attachHelixChannelVerification(channels, users),
    streams: attachHelixStreamVerification(streams, users),
  };
}

export async function fetchHelixUserVerification(
  input: HelixAuth & {
    readonly ids: readonly string[];
    readonly signal?: AbortSignal;
  },
): Promise<ReadonlyMap<string, HelixUserFlags>> {
  if (input.ids.length === 0 || input.clientId === null) return new Map();
  const accessToken = await input.readAccessToken();
  if (accessToken === null) return new Map();
  try {
    const response = await input.fetch(
      `${HELIX}/users?${input.ids
        .map((id) => `id=${encodeURIComponent(id)}`)
        .join("&")}`,
      requestInit(
        {
          Authorization: `Bearer ${accessToken}`,
          "Client-Id": input.clientId,
        },
        input.signal,
      ),
    );
    if (!response.ok) return new Map();
    return helixUserVerification(await response.json());
  } catch {
    return new Map();
  }
}

function uniqueIds(ids: readonly string[]): readonly string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  for (const id of ids) {
    if (id === "" || seen.has(id)) continue;
    seen.add(id);
    next.push(id);
  }
  return next;
}
