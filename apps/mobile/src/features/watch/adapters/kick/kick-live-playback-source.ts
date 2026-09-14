import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
} from "../../capabilities/watch";
import { kickHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";

export function createKickLivePlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"kick"> {
  return {
    integration: "kick-v1-playback-url",
    platform: "kick",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      const slug = encodeURIComponent(target.channelName.toLowerCase());
      try {
        const response = await input.fetch(
          `https://kick.com/api/v1/channels/${slug}`,
          {
            headers: {
              Accept: "application/json",
              ...kickHlsRequestHeaders(),
            },
            method: "GET",
            signal,
          },
        );
        if (response.status === 401 || response.status === 403) {
          return rejected(response.status);
        }
        if (response.status === 404) {
          return {
            failure: {
              detail: "This Kick channel is not live.",
              kind: "channel-offline",
            },
            integration: "kick-v1-playback-url",
            kind: "unavailable",
          };
        }
        if (!response.ok) return rejected(response.status);
        const payload: unknown = await response.json();
        if (!isLive(payload)) {
          return {
            failure: {
              detail: "This Kick channel is not live.",
              kind: "channel-offline",
            },
            integration: "kick-v1-playback-url",
            kind: "unavailable",
          };
        }
        const sourceUri = asHlsSourceUri(playbackUrl(payload) ?? "");
        if (!sourceUri) {
          return {
            failure: {
              detail: "Kick returned an unusable live source.",
              kind: "invalid-response",
            },
            integration: "kick-v1-playback-url",
            kind: "unavailable",
          };
        }
        return {
          integration: "kick-v1-playback-url",
          kind: "resolved",
          requestHeaders: kickHlsRequestHeaders(),
          sourceUri,
        };
      } catch (error) {
        if (isAbort(error)) {
          return {
            failure: { kind: "cancelled" },
            integration: "kick-v1-playback-url",
            kind: "unavailable",
          };
        }
        return {
          failure: {
            detail: "Could not reach Kick for live playback.",
            kind: "offline",
          },
          integration: "kick-v1-playback-url",
          kind: "unavailable",
        };
      }
    },
  };
}

function isLive(payload: unknown): boolean {
  if (!isRecord(payload) || !isRecord(payload.livestream)) return false;
  return payload.livestream.is_live === true;
}

function playbackUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.playback_url === "string") return payload.playback_url;
  if (isRecord(payload.livestream) && typeof payload.livestream.source === "string") {
    return payload.livestream.source;
  }
  return undefined;
}

function rejected(status: number): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Kick rejected the guest playback request.",
      kind: "provider-rejected",
      status,
    },
    integration: "kick-v1-playback-url",
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
