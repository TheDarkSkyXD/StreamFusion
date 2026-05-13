import type { AdBlockStatus } from "@/shared/adblock-types";

interface AdBlockFallbackOverlayProps {
  status: AdBlockStatus;
  channelName: string;
}

/**
 * Rich overlay that appears when all backup player types fail.
 *
 * NOTE: This overlay is DISABLED for seamless ad blocking experience.
 * We block ads at the HLS level silently without interrupting the user.
 * The overlay code is preserved in case it's needed for debugging or
 * if users want to opt-in to see ad blocking status in the future.
 */
export function AdBlockFallbackOverlay(_props: AdBlockFallbackOverlayProps) {
  // DISABLED: We want seamless ad blocking without visual interruption
  // The stream should continue playing as if ads don't exist
  // Keep overlay hidden - ads are blocked at network/HLS level
  return null;
}
