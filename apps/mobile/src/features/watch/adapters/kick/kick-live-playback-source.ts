import type { LiveStreamCatalog } from "@mobile/features/discovery/capabilities/live-stream-catalog";

import type {
  HlsSourceUri,
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
} from "../../capabilities/watch";
import { kickHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";

export function createKickLivePlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly liveCatalog?: LiveStreamCatalog;
}): LivePlaybackSourceResolver<"kick"> {
  return {
    integration: "kick-v1-playback-url",
    platform: "kick",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      if (signal.aborted) return cancelled();
      const slug = encodeURIComponent(target.channelName.toLowerCase());
      try {
        let catalogSource: HlsSourceUri | undefined;
        if (input.liveCatalog) {
          const catalog = await input.liveCatalog.read({ signal });
          if (
            signal.aborted ||
            (catalog.kind === "unavailable" &&
              catalog.failure.kind === "cancelled")
          ) {
            return cancelled();
          }
          if (catalog.kind === "ready") {
            const entry = catalog.entries.find(
              ({ stream }) =>
                stream.isLive &&
                stream.channelName.toLowerCase() ===
                  target.channelName.toLowerCase(),
            );
            catalogSource = asHlsSourceUri(entry?.playbackUrl ?? "");
          }
        }
        const signed = await requestGuestPlaybackSource({
          fetch: input.fetch,
          signal,
          slug,
        });
        if (signal.aborted) return cancelled();
        if (signed) return signed;
        if (catalogSource) {
          return {
            integration: "kick-v1-playback-url",
            kind: "resolved",
            requestHeaders: kickHlsRequestHeaders(),
            sourceUri: catalogSource,
          };
        }
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
        if (signal.aborted) return cancelled();
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
        if (signal.aborted) return cancelled();
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
        if (signal.aborted || isAbort(error)) return cancelled();
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

async function requestGuestPlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
  readonly signal: AbortSignal;
  readonly slug: string;
}): Promise<LivePlaybackSourceResolution | null> {
  if (input.signal.aborted) return cancelled();
  try {
    const response = await input.fetch(
      `https://kick.com/api/v2/channels/${input.slug}/playback-url`,
      {
        headers: { Accept: "application/json", ...kickHlsRequestHeaders() },
        method: "GET",
        signal: input.signal,
      },
    );
    if (input.signal.aborted) return cancelled();
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    if (input.signal.aborted) return cancelled();
    if (!isRecord(payload) || typeof payload.data !== "string") return null;
    const sourceUri = asHlsSourceUri(payload.data);
    if (!sourceUri) return null;
    return {
      integration: "kick-v1-playback-url",
      kind: "resolved",
      requestHeaders: kickHlsRequestHeaders(),
      sourceUri,
    };
  } catch (error) {
    return input.signal.aborted || isAbort(error) ? cancelled() : null;
  }
}

function cancelled(): LivePlaybackSourceResolution {
  return {
    failure: { kind: "cancelled" },
    integration: "kick-v1-playback-url",
    kind: "unavailable",
  };
}

function isLive(payload: unknown): boolean {
  if (!isRecord(payload) || !isRecord(payload.livestream)) return false;
  return payload.livestream.is_live === true;
}

function playbackUrl(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  if (typeof payload.playback_url === "string") return payload.playback_url;
  if (
    isRecord(payload.livestream) &&
    typeof payload.livestream.source === "string"
  ) {
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
