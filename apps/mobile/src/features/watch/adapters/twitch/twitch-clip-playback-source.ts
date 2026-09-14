import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
} from "../../capabilities/watch";
import { twitchHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";

const TWITCH_GQL_URL = "https://gql.twitch.tv/gql";
const TWITCH_CLIENT_ID = "kd1unb4b3q4t58fwlpcbzcbnm76a8fp";

export function createTwitchClipPlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"twitch"> {
  return {
    integration: "twitch-gql-clip",
    platform: "twitch",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      const slug = target.media?.kind === "clip" ? target.media.id : "";
      if (slug === "") {
        return {
          failure: {
            detail: "Twitch clip playback needs a recorded Watch target.",
            kind: "invalid-response",
          },
          integration: "twitch-gql-clip",
          kind: "unavailable",
        };
      }
      try {
        const response = await input.fetch(TWITCH_GQL_URL, {
          body: JSON.stringify({
            query:
              "query VideoAccessToken_Clip($slug: ID!) { clip(slug: $slug) { playbackAccessToken(params: {platform: \"web\", playerType: \"site\"}) { signature value } videoQualities { sourceURL } } }",
            variables: { slug },
          }),
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
        const sourceUri = asHlsSourceUri(signedClipUrl(await response.json()));
        if (!sourceUri) {
          return {
            failure: {
              detail: "Twitch returned an unusable clip source.",
              kind: "invalid-response",
            },
            integration: "twitch-gql-clip",
            kind: "unavailable",
          };
        }
        return {
          integration: "twitch-gql-clip",
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

function signedClipUrl(payload: unknown): string {
  if (!isRecord(payload) || !isRecord(payload.data) || !isRecord(payload.data.clip)) {
    return "";
  }
  const clip = payload.data.clip;
  const token = isRecord(clip.playbackAccessToken) ? clip.playbackAccessToken : null;
  const signature = token && typeof token.signature === "string" ? token.signature : "";
  const value = token && typeof token.value === "string" ? token.value : "";
  const qualities = Array.isArray(clip.videoQualities) ? clip.videoQualities : [];
  const source = qualities
    .map((row) => (isRecord(row) && typeof row.sourceURL === "string" ? row.sourceURL : ""))
    .find((url) => url.length > 0);
  if (!source || signature === "" || value === "") return "";
  const url = new URL(source);
  url.searchParams.set("sig", signature);
  url.searchParams.set("token", value);
  return url.toString();
}

function rejected(status: number): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Twitch rejected the guest clip request.",
      kind: "provider-rejected",
      status,
    },
    integration: "twitch-gql-clip",
    kind: "unavailable",
  };
}

function failureFrom(error: unknown): LivePlaybackSourceResolution {
  if (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  ) {
    return {
      failure: { kind: "cancelled" },
      integration: "twitch-gql-clip",
      kind: "unavailable",
    };
  }
  return {
    failure: {
      detail: "Could not reach Twitch for clip playback.",
      kind: "offline",
    },
    integration: "twitch-gql-clip",
    kind: "unavailable",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
