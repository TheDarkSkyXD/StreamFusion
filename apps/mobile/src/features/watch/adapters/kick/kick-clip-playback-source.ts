import type {
  LivePlaybackSourceResolution,
  LivePlaybackSourceResolver,
} from "../../capabilities/watch";
import { kickHlsRequestHeaders } from "../../domain/hls-request-headers";
import { asHlsSourceUri } from "../../domain/hls-source";

export function createKickClipPlaybackSource(input: {
  readonly fetch: typeof globalThis.fetch;
}): LivePlaybackSourceResolver<"kick"> {
  return {
    integration: "kick-v2-clip",
    platform: "kick",
    async resolve({ signal, target }): Promise<LivePlaybackSourceResolution> {
      const id = target.media?.kind === "clip" ? target.media.id : "";
      if (id === "")
        return unavailable("Kick clip playback needs a clip target.");
      try {
        const response = await input.fetch(
          `https://kick.com/api/v2/clips/${encodeURIComponent(id)}`,
          {
            headers: { Accept: "application/json" },
            method: "GET",
            signal,
          },
        );
        if (!response.ok) {
          return {
            failure: {
              detail: "Kick rejected the guest clip request.",
              kind: "provider-rejected",
              status: response.status,
            },
            integration: "kick-v2-clip",
            kind: "unavailable",
          };
        }
        const payload: unknown = await response.json();
        const clip =
          isRecord(payload) && isRecord(payload.clip) ? payload.clip : null;
        const sourceUri = asHlsSourceUri(
          clip !== null && clip.id === id && typeof clip.video_url === "string"
            ? clip.video_url
            : "",
        );
        if (!sourceUri)
          return unavailable("Kick returned an unusable clip source.");
        return {
          integration: "kick-v2-clip",
          kind: "resolved",
          requestHeaders: kickHlsRequestHeaders(),
          sourceUri,
        };
      } catch (error) {
        if (
          signal.aborted ||
          (error instanceof Error && error.name === "AbortError")
        ) {
          return {
            failure: { kind: "cancelled" },
            integration: "kick-v2-clip",
            kind: "unavailable",
          };
        }
        return {
          failure: {
            detail: "Could not reach Kick for clip playback.",
            kind: "offline",
          },
          integration: "kick-v2-clip",
          kind: "unavailable",
        };
      }
    },
  };
}

function unavailable(detail: string): LivePlaybackSourceResolution {
  return {
    failure: { detail, kind: "invalid-response" },
    integration: "kick-v2-clip",
    kind: "unavailable",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
