/**
 * Custom HLS.js Playlist Loader for Twitch Ad-Blocking
 *
 * This loader intercepts m3u8 playlist requests and processes them
 * through the TwitchAdBlockService to remove ads.
 *
 * Usage:
 * ```typescript
 * import Hls from 'hls.js';
 * import { createAdBlockLoader } from './twitch-adblock-loader';
 *
 * const hls = new Hls({
 *     pLoader: createAdBlockLoader(Hls, channelName),
 * });
 * ```
 */

import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
  LoaderResponse,
  LoaderStats,
} from "hls.js";
import Hls from "hls.js";

import { logger } from "@/renderer/logging/logger";

import {
  getBlankVideoDataUrl,
  isAdBlockEnabled,
  isAdSegment,
  processMasterPlaylist,
  processMediaPlaylist,
} from "./twitch-adblock-service";

/**
 * Extract channel name from a Twitch usher URL
 */
function extractChannelName(url: string): string | null {
  // Match /channel/hls/{channel}.m3u8 or /api/channel/hls/{channel}.m3u8
  const match = url.match(/\/channel\/hls\/([^/.]+)\.m3u8/);
  return match?.[1]?.toLowerCase() ?? null;
}

/**
 * Check if URL is a master playlist (usher URL)
 */
function isMasterPlaylist(url: string): boolean {
  return url.includes("usher.ttvnw.net") && url.includes("/channel/hls/");
}

/**
 * Check if URL is a media playlist (quality-specific m3u8)
 * Note: Must use includes() not endsWith() because Twitch URLs have query params
 */
function isMediaPlaylist(url: string): boolean {
  return url.includes(".m3u8") && !isMasterPlaylist(url);
}

/**
 * Check if URL is a Twitch segment (.ts or .m4s for LL-HLS)
 * Note: Must handle URLs with query parameters
 */
function isTwitchSegment(url: string): boolean {
  // Check for segment extensions (handle query params)
  const hasSegmentExtension = /\.(ts|m4s)(\?|$)/i.test(url);
  const isTwitchDomain =
    url.includes("ttvnw.net") || url.includes("cloudfront.net") || url.includes("akamaized.net");
  return hasSegmentExtension && isTwitchDomain;
}

/**
 * HLS.js loader constructor type
 */
type LoaderConstructor = new (config: HlsConfig) => Loader<LoaderContext>;

/**
 * Create an ad-blocking playlist loader for HLS.js
 *
 * This loader ONLY handles .m3u8 playlist files. Segment replacement
 * is handled by the fragment loader (createAdBlockFragmentLoader).
 *
 * @param channelName - Optional channel name (will be extracted from URL if not provided)
 * @returns A loader class that can be used as pLoader in HLS.js config
 */
export function createAdBlockPlaylistLoader(channelName?: string): LoaderConstructor {
  // Get the default loader class
  const DefaultLoader = Hls.DefaultConfig.loader;

  // Store channel name in closure
  let storedChannelName = channelName?.toLowerCase() ?? null;

  // Create a custom loader class that extends DefaultLoader and implements Loader<LoaderContext>
  const AdBlockLoader = class extends DefaultLoader implements Loader<LoaderContext> {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ): void {
      const url: string = context.url;

      // If ad-blocking is disabled, pass through directly
      if (!isAdBlockEnabled()) {
        super.load(context, config, callbacks);
        return;
      }

      // Handle m3u8 playlist processing
      // Note: Must use includes() not endsWith() because Twitch URLs have query params
      if (url.includes(".m3u8")) {
        const originalOnSuccess = callbacks.onSuccess;

        // Debug logging for troubleshooting
        // const isMaster = isMasterPlaylist(url);
        // const isMedia = isMediaPlaylist(url);
        // console.debug(
        //   `[AdBlockLoader] Intercepting ${isMaster ? "MASTER" : isMedia ? "MEDIA" : "UNKNOWN"} playlist`
        // );

        callbacks.onSuccess = async (
          response: LoaderResponse,
          stats: LoaderStats,
          ctx: LoaderContext,
          networkDetails: unknown
        ) => {
          try {
            // Only process if we have text data
            if (typeof response.data === "string") {
              let processedData = response.data;

              if (isMasterPlaylist(url)) {
                // Extract channel name from URL if not provided
                const channel = storedChannelName ?? extractChannelName(url);
                if (channel) {
                  storedChannelName = channel;
                  // console.debug(`[AdBlockLoader] Processing master playlist for ${channel}`);
                  processedData = await processMasterPlaylist(url, response.data, channel);
                }
              } else if (isMediaPlaylist(url)) {
                // Check for ads in the original response
                const hasAds =
                  response.data.includes("stitched") ||
                  response.data.includes("twitch-stitched-ad");
                if (hasAds) {
                  // console.debug("[AdBlockLoader] Ads detected in media playlist, processing...");
                }
                processedData = await processMediaPlaylist(url, response.data);
              }

              // Return modified response
              originalOnSuccess({ ...response, data: processedData }, stats, ctx, networkDetails);
            } else {
              // Non-text response (shouldn't happen for m3u8), pass through
              originalOnSuccess(response, stats, ctx, networkDetails);
            }
          } catch (error) {
            logger.error("Player:Twitch:AdblockLoader", "error processing playlist", {
              error: error instanceof Error ? error.message : String(error),
            });
            // On error, pass through original response
            originalOnSuccess(response, stats, ctx, networkDetails);
          }
        };
      }

      // Load with potentially modified callbacks
      super.load(context, config, callbacks);
    }
  };

  return AdBlockLoader as LoaderConstructor;
}

/**
 * Create a fragment loader that handles ad segment replacement
 *
 * Use this as fLoader in HLS.js config to intercept segment requests
 */
export function createAdBlockFragmentLoader(): LoaderConstructor {
  const DefaultLoader = Hls.DefaultConfig.loader;

  const AdBlockFragmentLoader = class extends DefaultLoader implements Loader<LoaderContext> {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>
    ): void {
      const url: string = context.url;

      // If this is a cached ad segment, replace with blank video
      if (isAdBlockEnabled() && isTwitchSegment(url) && isAdSegment(url)) {
        logger.debug("Player:Twitch:AdblockLoader", "replacing ad segment with blank video");
        const blankUrl = getBlankVideoDataUrl();
        const modifiedContext: LoaderContext = { ...context, url: blankUrl };
        super.load(modifiedContext, config, callbacks);
        return;
      }

      // Normal segment loading
      super.load(context, config, callbacks);
    }
  };

  return AdBlockFragmentLoader as LoaderConstructor;
}

/**
 * HLS.js configuration options with ad-blocking enabled
 *
 * Use this helper to get HLS config with ad-blocking loaders
 */
export interface AdBlockHlsConfig {
  pLoader: LoaderConstructor;
  fLoader: LoaderConstructor;
}

/**
 * Get HLS.js config with ad-blocking loaders
 */
export function getAdBlockHlsConfig(channelName?: string): AdBlockHlsConfig {
  return {
    pLoader: createAdBlockPlaylistLoader(channelName),
    fLoader: createAdBlockFragmentLoader(),
  };
}
