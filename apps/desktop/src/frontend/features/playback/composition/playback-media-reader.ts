import type { PlaybackMediaReader } from "../capabilities/playback-media-reader";
import { getDesktopPlaybackMediaReader } from "../adapters/electron/playback-media-reader";

export const getPlaybackMediaReader: () => PlaybackMediaReader = getDesktopPlaybackMediaReader;
