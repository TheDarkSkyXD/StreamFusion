import { authEs } from "./es/auth";
import { chatEs } from "./es/chat";
import { chatModerationEs } from "./es/chatModeration";
import { coreEs } from "./es/core";
import { discoveryEs } from "./es/discovery";
import { mediaLibraryEs } from "./es/mediaLibrary";
import { moderationEs } from "./es/moderation";
import { multistreamEs } from "./es/multistream";
import { playbackEs } from "./es/playback";
import { settingsEs } from "./es/settings";
import { shellEs } from "./es/shell";

export const es = {
  ...coreEs,
  ...shellEs,
  ...authEs,
  ...discoveryEs,
  ...mediaLibraryEs,
  ...playbackEs,
  ...multistreamEs,
  ...moderationEs,
  ...chatEs,
  ...chatModerationEs,
  ...settingsEs,
} as const;
