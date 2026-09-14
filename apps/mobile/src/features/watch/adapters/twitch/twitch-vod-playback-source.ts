import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
  WatchTarget,
} from "../../capabilities/watch";
import { twitchHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const PLAYBACK_ACCESS_TOKEN_HASH =
  "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";

export function createTwitchVodPlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"twitch"> {
  return {
    integration: "twitch-gql-vod",
    platform: "twitch",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      const vodId = target.media?.kind === "video" ? target.media.id : "";
      if (vodId === "") {
        return {
          failure: {
            detail: "Twitch video playback needs a recorded Watch target.",
            kind: "invalid-response",
          },
          integration: "twitch-gql-vod",
          kind: "unavailable",
        };
      }
      try {
        const response = await input.fetch(TWITCH_GQL_URL, {
          body: JSON.stringify(playbackAccessTokenBody(vodId)),
          headers: {
            "Client-Id": TWITCH_CLIENT_ID,
            "Content-Type": "application/json",
          },
          method: "POST",
          signal,
        });
        if (response.status === 401 || response.status === 403) {
          return rejected(response.status);
        }
        if (!response.ok) return rejected(response.status);
        const token = videoToken(await response.json());
        if (token === null) {
          return {
            failure: {
              detail: "This Twitch video is not available.",
              kind: "invalid-response",
            },
            integration: "twitch-gql-vod",
            kind: "unavailable",
          };
        }
        const sourceUri = asHlsSourceUri(usherUrl(vodId, token));
        if (!sourceUri) {
          return {
            failure: {
              detail: "Twitch returned an unusable video source.",
              kind: "invalid-response",
            },
            integration: "twitch-gql-vod",
            kind: "unavailable",
          };
        }
        return {
          integration: "twitch-gql-vod",
          kind: "resolved",
          requestHeaders: twitchHlsRequestHeaders(),
          sourceUri,
        };
      } catch (error) {
        return failureFrom(error);
      }
    },
  };
}

function playbackAccessTokenBody(vodID: string) {
  return {
    extensions: {
      persistedQuery: {
        sha256Hash: PLAYBACK_ACCESS_TOKEN_HASH,
        version: 1,
      },
    },
    operationName: "PlaybackAccessToken",
    variables: {
      isLive: false,
      isVod: true,
      login: "",
      platform: "web",
      playerType: "site",
      vodID,
    },
  };
}

function videoToken(payload: unknown): { signature: string; value: string } | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const token = payload.data.videoPlaybackAccessToken;
  if (!isRecord(token)) return null;
  const signature = token.signature;
  const value = token.value;
  if (typeof signature !== "string" || signature.length === 0) return null;
  if (typeof value !== "string" || value.length === 0) return null;
  return { signature, value };
}

function usherUrl(
  vodId: string,
  token: { signature: string; value: string },
): string {
  const params = new URLSearchParams({
    allow_audio_only: "true",
    allow_source: "true",
    p: String(Math.floor(Math.random() * 999999)),
    sig: token.signature,
    token: token.value,
  });
  return `https://usher.ttvnw.net/vod/${encodeURIComponent(vodId)}.m3u8?${params.toString()}`;
}

function rejected(status: number): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Twitch rejected the guest video request.",
      kind: "provider-rejected",
      status,
    },
    integration: "twitch-gql-vod",
    kind: "unavailable",
  };
}

function failureFrom(error: unknown): LivePlaybackSourceResolution {
  if (isAbort(error)) {
    return {
      failure: { kind: "cancelled" },
      integration: "twitch-gql-vod",
      kind: "unavailable",
    };
  }
  return {
    failure: {
      detail: "Could not reach Twitch for video playback.",
      kind: "offline",
    },
    integration: "twitch-gql-vod",
    kind: "unavailable",
  };
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export type { WatchTarget };
