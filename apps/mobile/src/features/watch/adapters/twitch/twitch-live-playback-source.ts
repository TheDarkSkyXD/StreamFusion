import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
  WatchTarget,
} from "../../capabilities/watch";
import { twitchHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";
import { isAbortError } from "../../utils/is-abort-error";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";
const PLAYBACK_ACCESS_TOKEN_HASH =
  "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9";
const STREAM_METADATA_QUERY = `query VideoPlayerStreamMetadata($login: String!) {
  user(login: $login) { stream { isEncrypted } }
}`;

export function createTwitchLivePlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"twitch"> {
  return {
    integration: "twitch-gql-usher",
    platform: "twitch",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      try {
        const response = await input.fetch(TWITCH_GQL_URL, {
          body: JSON.stringify([
            {
              operationName: "VideoPlayerStreamMetadata",
              query: STREAM_METADATA_QUERY,
              variables: { login: target.channelName },
            },
            playbackAccessTokenBody(target),
          ]),
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
        if (!Array.isArray(payload) || payload.length !== 2) return invalid();
        const [metadataPayload, tokenPayload] = payload;
        const isEncrypted = streamEncryption(metadataPayload);
        if (isEncrypted === null) return invalid();
        const token = streamToken(tokenPayload);
        if (isEncrypted === "offline" || token === null) {
          if (
            isEncrypted !== "offline" &&
            !isExplicitOfflineToken(tokenPayload)
          )
            return invalid();
          return {
            failure: {
              detail: "This Twitch channel is not live.",
              kind: "channel-offline",
            },
            integration: "twitch-gql-usher",
            kind: "unavailable",
          };
        }
        const sourceUri = asHlsSourceUri(
          usherUrl(target.channelName, token, isEncrypted),
        );
        if (!sourceUri) {
          return invalid();
        }
        return {
          integration: "twitch-gql-usher",
          kind: "resolved",
          requestHeaders: twitchHlsRequestHeaders(),
          sourceUri,
          ...(isEncrypted
            ? {
                protection: {
                  kind: "widevine" as const,
                  authorization: {
                    kind: "provider-live" as const,
                    platform: "twitch" as const,
                    channelName: target.channelName,
                  },
                },
              }
            : {}),
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

function streamToken(
  payload: unknown,
): { signature: string; value: string } | null {
  if (
    !isRecord(payload) ||
    payload.errors !== undefined ||
    !isRecord(payload.data)
  )
    return null;
  const token = payload.data.streamPlaybackAccessToken;
  if (!isRecord(token)) return null;
  const signature = token.signature;
  const value = token.value;
  if (typeof signature !== "string" || signature.length === 0) return null;
  if (typeof value !== "string" || value.length === 0) return null;
  return { signature, value };
}

function isExplicitOfflineToken(payload: unknown): boolean {
  return (
    isRecord(payload) &&
    payload.errors === undefined &&
    isRecord(payload.data) &&
    payload.data.streamPlaybackAccessToken === null
  );
}

function streamEncryption(payload: unknown): boolean | "offline" | null {
  if (
    !isRecord(payload) ||
    payload.errors !== undefined ||
    !isRecord(payload.data)
  )
    return null;
  const user = payload.data.user;
  if (user === null) return "offline";
  if (!isRecord(user)) return null;
  if (user.stream === null) return "offline";
  if (!isRecord(user.stream)) return null;
  return typeof user.stream.isEncrypted === "boolean"
    ? user.stream.isEncrypted
    : null;
}

function usherUrl(
  channelName: string,
  token: { signature: string; value: string },
  isEncrypted: boolean,
): string {
  const channel = encodeURIComponent(channelName.toLowerCase());
  const params = new URLSearchParams({
    allow_audio_only: "true",
    allow_source: "true",
    p: String(Math.floor(Math.random() * 999999)),
    sig: token.signature,
    token: token.value,
  });
  if (isEncrypted) {
    params.set("cdm", "wv");
    params.set("player_backend", "mediaplayer");
    params.set("playlist_include_framerate", "true");
    params.set("supported_codecs", "h264");
  }
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
  if (isAbortError(error)) {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
