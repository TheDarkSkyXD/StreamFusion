import type { MediaJobIntent } from "@streamfusion/core/media-jobs";
import type { MediaDisplayMetadata } from "../utils/media-display";
export type { MediaDisplayMetadata } from "../utils/media-display";
export type DisplayMediaJobIntent = MediaJobIntent & {
  readonly display: MediaDisplayMetadata;
};
