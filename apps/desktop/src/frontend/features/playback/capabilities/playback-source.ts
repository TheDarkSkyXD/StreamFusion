import type { Platform } from "@streamfusion/core/platform";
import type { StreamPlayback } from "./media-types";

export interface PlaybackSourceResolver {
  isAvailable(): boolean;
  resolve(request: {
    platform: Platform;
    identifier: string;
    intent: "play" | "recover";
  }): Promise<StreamPlayback>;
}
