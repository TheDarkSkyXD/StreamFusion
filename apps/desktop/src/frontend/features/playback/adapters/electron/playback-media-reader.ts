import type { PlaybackMediaReader } from "../../capabilities/playback-media-reader";

export function getDesktopPlaybackMediaReader(): PlaybackMediaReader {
 return window.electronAPI;
}
