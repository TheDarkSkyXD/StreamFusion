import { authEn } from "./en/auth";
import { chatEn } from "./en/chat";
import { chatModerationEn } from "./en/chatModeration";
import { coreEn } from "./en/core";
import { discoveryEn } from "./en/discovery";
import { devEn } from "./en/dev";
import { mediaLibraryEn } from "./en/mediaLibrary";
import { moderationEn } from "./en/moderation";
import { multistreamEn } from "./en/multistream";
import { nativeEn } from "./en/native";
import { playbackEn } from "./en/playback";
import { settingsEn } from "./en/settings";
import { shellEn } from "./en/shell";
import type { TranslationShape } from "./schema";

export const en = {
  ...coreEn,
  ...shellEn,
  ...authEn,
  ...devEn,
  ...discoveryEn,
  ...mediaLibraryEn,
  ...playbackEn,
  ...multistreamEn,
  ...nativeEn,
  ...moderationEn,
  ...chatEn,
  ...chatModerationEn,
  ...settingsEn,
} as const;

export type TranslationCatalog = TranslationShape<typeof en>;
