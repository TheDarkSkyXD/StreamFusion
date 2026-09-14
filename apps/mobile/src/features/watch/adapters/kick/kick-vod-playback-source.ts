import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
} from "../../capabilities/watch";
import { kickHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";

export function createKickVideoPlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"kick"> {
  return {
    integration: "kick-v2-video",
    platform: "kick",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      const media = target.media;
      if (media?.kind !== "video") return missing();
      const fromTarget = asHlsSourceUri(media.sourceUri ?? "");
      if (fromTarget) return resolved(fromTarget);
      try {
        const slug = encodeURIComponent(target.channelName.toLowerCase());
        const response = await input.fetch(
          `https://kick.com/api/v2/channels/${slug}/videos?limit=20`,
          {
            headers: { Accept: "application/json" },
            method: "GET",
            signal,
          },
        );
        if (response.status === 401 || response.status === 403) {
          return rejected(response.status);
        }
        if (!response.ok) return rejected(response.status);
        const sourceUri = asHlsSourceUri(sourceFor(await response.json(), media.id));
        if (!sourceUri) {
          return {
            failure: {
              detail: "This Kick video is not available without a subscription.",
              kind: "invalid-response",
            },
            integration: "kick-v2-video",
            kind: "unavailable",
          };
        }
        return resolved(sourceUri);
      } catch (error) {
        return failureFrom(error);
      }
    },
  };
}

function sourceFor(value: unknown, videoId: string): string {
  const rows = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.data)
      ? value.data
      : [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    if (String(row.id ?? "") !== videoId) continue;
    return typeof row.source === "string" ? row.source : "";
  }
  return "";
}

function resolved(
  sourceUri: NonNullable<ReturnType<typeof asHlsSourceUri>>,
): LivePlaybackSourceResolution {
  return {
    integration: "kick-v2-video",
    kind: "resolved",
    requestHeaders: kickHlsRequestHeaders(),
    sourceUri,
  };
}

function missing(): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Kick video playback needs a recorded Watch target.",
      kind: "invalid-response",
    },
    integration: "kick-v2-video",
    kind: "unavailable",
  };
}

function rejected(status: number): LivePlaybackSourceResolution {
  return {
    failure: {
      detail: "Kick rejected the guest video request.",
      kind: "provider-rejected",
      status,
    },
    integration: "kick-v2-video",
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
      integration: "kick-v2-video",
      kind: "unavailable",
    };
  }
  return {
    failure: {
      detail: "Could not reach Kick for video playback.",
      kind: "offline",
    },
    integration: "kick-v2-video",
    kind: "unavailable",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
