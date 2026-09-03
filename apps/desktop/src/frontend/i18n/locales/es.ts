import { authEs } from "./es/auth";
import { chatEs } from "./es/chat";
import { chatModerationEs } from "./es/chatModeration";
import { coreEs } from "./es/core";
import { discoveryEs } from "./es/discovery";
import { devEs } from "./es/dev";
import { mediaLibraryEs } from "./es/mediaLibrary";
import { moderationEs } from "./es/moderation";
import { multistreamEs } from "./es/multistream";
import { nativeEs } from "./es/native";
import { playbackEs } from "./es/playback";
import { settingsEs } from "./es/settings";
import { shellEs } from "./es/shell";

export const es = {
  ...coreEs,
  ...shellEs,
  ...authEs,
  ...devEs,
  ...discoveryEs,
  ...mediaLibraryEs,
  ...playbackEs,
  ...multistreamEs,
  ...nativeEs,
  ...moderationEs,
  ...chatEs,
  ...chatModerationEs,
  ...settingsEs,
} as const;
