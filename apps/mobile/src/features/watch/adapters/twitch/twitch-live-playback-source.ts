import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
  WatchTarget,
} from "../../capabilities/watch";
import { asHlsSourceUri } from "../../domain/hls-source";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const PLAYBACK_ACCESS_TOKEN_HASH =
  "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";

export function createTwitchLivePlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"twitch"> {
  return {
    integration: "twitch-gql-usher",
    platform: "twitch",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      try {
        const response = await input.fetch(TWITCH_GQL_URL, {
          body: JSON.stringify(playbackAccessTokenBody(target)),
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
        if (!response.ok) {
          return rejected(response.status);
        }
        const payload: unknown = await response.json();
        const token = streamToken(payload);
        if (token === null) {
          return {
            failure: {
              detail: "This Twitch channel is not live.",
              kind: "channel-offline",
            },
            integration: "twitch-gql-usher",
            kind: "unavailable",
          };
        }
        const sourceUri = asHlsSourceUri(usherUrl(target.channelName, token));
        if (!sourceUri) {
          return invalid();
        }
        return {
          integration: "twitch-gql-usher",
          kind: "resolved",
          sourceUri,
        };
      } catch (error) {
        return failureFrom(error);
      }
    },
  };
}

function playbackAccessTokenBody(target: WatchTarget) {
  return {
    extensions: {
      persistedQuery: {
        sha256Hash: PLAYBACK_ACCESS_TOKEN_HASH,
        version: 1,
      },
    },
    operationName: "PlaybackAccessToken",
    variables: {
      isLive: true,
      isVod: false,
      login: target.channelName,
      platform: "web",
      playerType: "site",
      vodID: "",
    },
  };
}

function streamToken(payload: unknown): { signature: string; value: string } | null {
  if (!isRecord(payload) || !isRecord(payload.data)) return null;
  const token = payload.data.streamPlaybackAccessToken;
  if (!isRecord(token)) return null;
  const signature = token.signature;
  const value = token.value;
  if (typeof signature !== "string" || signature.length === 0) return null;
  if (typeof value !== "string" || value.length === 0) return null;
  return { signature, value };
}

function usherUrl(
  channelName: string,
  token: { signature: string; value: string },
): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  const params = new URLSearchParams({
    allow_audio_only: "true",
    allow_source: "true",
    p: String(Math.floor(Math.random() * 999999)),
    sig: token.signature,
    token: token.value,
  });
  return `https://usher.ttvnw.net/api/channel/hls/${channel}.m3u8?${params.toString()}`;
}

function rejected(status: number): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Twitch rejected the guest playback request.",
      kind: "provider-rejected",
      status,
    },
    integration: "twitch-gql-usher",
    kind: "unavailable",
  };
}

function invalid(): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Twitch returned an unusable live source.",
      kind: "invalid-response",
    },
    integration: "twitch-gql-usher",
    kind: "unavailable",
  };
}

function failureFrom(error: unknown): LivePlaybackSourceResolution {
  if (isAbort(error)) {
    return {
      failure: { kind: "cancelled" },
      integration: "twitch-gql-usher",
      kind: "unavailable",
    };
  }
  return {
    failure: {
      detail: "Could not reach Twitch for live playback.",
      kind: "offline",
    },
    integration: "twitch-gql-usher",
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
