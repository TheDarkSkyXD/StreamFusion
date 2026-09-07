import { type CaptionPreferences, DEFAULT_CAPTION_PREFERENCES } from "@shared/auth-types";

export interface LegacyLocalCaptionUnavailable {
  status: "unavailable";
  reason: "legacy-generated-disabled";
}

export interface LegacyLocalCaptionSelection {
  sourceId: "legacy-local-caption";
  modelId: string | null;
  availability: LegacyLocalCaptionUnavailable;
}

export interface NoDownloadCaptionPreferenceNormalization {
  preferences: CaptionPreferences;
  legacyLocalSelection: LegacyLocalCaptionSelection | null;
}

const BCP_47_PATTERN = /^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i;
const MODEL_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/i;

function validLanguage(value: unknown): string | null {
  return value === null || (typeof value === "string" && BCP_47_PATTERN.test(value))
    ? value
    : DEFAULT_CAPTION_PREFERENCES.preferredLanguage;
}

function validModelId(value: unknown): string | null {
  return typeof value === "string" && MODEL_ID_PATTERN.test(value) ? value : null;
}

function validNumberInRange(value: unknown, minimum: number, maximum: number, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : fallback;
}

function normalizeCurrentPreferences(
  stored: Record<string, unknown>,
  enabled: boolean
): CaptionPreferences {
  return {
    enabled,
    source: "platform",
    preferredLanguage: validLanguage(stored.preferredLanguage),
    localModelId: null,
    textSizePercent: validNumberInRange(
      stored.textSizePercent,
      75,
      200,
      DEFAULT_CAPTION_PREFERENCES.textSizePercent
    ),
    backgroundOpacityPercent: validNumberInRange(
      stored.backgroundOpacityPercent,
      0,
      100,
      DEFAULT_CAPTION_PREFERENCES.backgroundOpacityPercent
    ),
  };
}

export function normalizeNoDownloadCaptionPreferences(
  value: unknown
): NoDownloadCaptionPreferenceNormalization {
  if (!value || typeof value !== "object") {
    return { preferences: { ...DEFAULT_CAPTION_PREFERENCES }, legacyLocalSelection: null };
  }

  const stored = value as Record<string, unknown>;
  if (stored.source === "platform" || stored.source === undefined) {
    return {
      preferences: normalizeCurrentPreferences(
        stored,
        typeof stored.enabled === "boolean" ? stored.enabled : DEFAULT_CAPTION_PREFERENCES.enabled
      ),
      legacyLocalSelection: null,
    };
  }

  if (stored.source !== "local") {
    return { preferences: { ...DEFAULT_CAPTION_PREFERENCES }, legacyLocalSelection: null };
  }

  return {
    preferences: normalizeCurrentPreferences(stored, false),
    legacyLocalSelection: {
      sourceId: "legacy-local-caption",
      modelId: validModelId(stored.localModelId),
      availability: {
        status: "unavailable",
        reason: "legacy-generated-disabled",
      },
    },
  };
}
