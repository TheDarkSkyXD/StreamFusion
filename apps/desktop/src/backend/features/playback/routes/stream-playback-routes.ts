import { z } from "zod";

import { logger } from "@backend/logging/logger";
import { IPC_CHANNELS, type StreamPlaybackRequest } from "@shared/ipc-channels";

import { trustedIpcMain as ipcMain } from "../../../ipc/trusted-ipc-main";
import { resolveKickFollowPlaybackSlug } from "../../authentication/adapters/kick/kick-follow-identity-service";

const streamPlaybackRequestSchema = z
  .object({
    platform: z.enum(["twitch", "kick"]),
    channelSlug: z.string().trim().min(1).max(128),
    intent: z.enum(["play", "recover"]),
  })
  .strict();

function parseStreamPlaybackRequest(value: unknown): StreamPlaybackRequest | null {
  const parsed = streamPlaybackRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Registers the feature-owned playback URL IPC route. */
export function registerStreamPlaybackRoutes(): void {
  ipcMain.handle(IPC_CHANNELS.STREAMS_GET_PLAYBACK_URL, async (_event, payload: unknown) => {
    const params = parseStreamPlaybackRequest(payload);
    if (!params) return { success: false, error: "Invalid Stream playback request" };

    try {
      if (params.platform === "twitch") {
        const { TwitchStreamResolver } = await import("../adapters/twitch/twitch-stream-resolver");
        return {
          success: true,
          data: await new TwitchStreamResolver().getStreamPlaybackUrl(params.channelSlug),
        };
      }

      const [{ KickStreamResolver }, { kickDiscovery }] = await Promise.all([
        import("../adapters/kick/kick-stream-resolver"),
        import("@backend/features/discovery/composition/kick-discovery"),
      ]);
      const resolver = new KickStreamResolver();
      const resolve = (channelSlug: string) =>
        params.intent === "recover"
          ? resolver.getStreamPlaybackUrl(channelSlug, { forceRefresh: true })
          : resolver.getStreamPlaybackUrl(channelSlug);
      try {
        return { success: true, data: await resolve(params.channelSlug) };
      } catch (error) {
        const resolvedSlug = await resolveKickFollowPlaybackSlug(kickDiscovery, params.channelSlug);
        if (!resolvedSlug || resolvedSlug.toLowerCase() === params.channelSlug.toLowerCase())
          throw error;
        logger.info("IPC:Stream", "Retrying Kick playback with resolved channel slug", {
          requestedSlug: params.channelSlug,
          resolvedSlug,
        });
        return { success: true, data: await resolve(resolvedSlug) };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.toLowerCase().includes("offline")) {
        logger.error("IPC:Stream", "Failed to get stream playback URL", {
          error:
            error instanceof Error
              ? { name: error.name, message: error.message, stack: error.stack }
              : message,
        });
      }
      return { success: false, error: message || "Failed to resolve stream URL" };
    }
  });
}
