import type { HlsConfigOverrides } from "../hls-player";

import { createKickClipPlaylistLoader, isKickClipPlaylistUrl } from "./kick-clip-loader";

export function resolveKickHlsConfig(
  src: string | null | undefined
): HlsConfigOverrides | undefined {
  if (!isKickClipPlaylistUrl(src)) return undefined;

  return {
    // Kick clips are cut mid-GOP, so seg 0 has no keyframe and hls.js
    // opens an audio-only MediaSource that can't accept the video that
    // shows up in seg 1. See kick-clip-loader.ts.
    pLoader: createKickClipPlaylistLoader(),
  };
}
