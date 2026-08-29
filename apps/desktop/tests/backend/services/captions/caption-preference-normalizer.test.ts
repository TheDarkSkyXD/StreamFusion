import { describe, expect, it } from "vitest";

import { normalizeNoDownloadCaptionPreferences } from "@backend/services/captions/caption-preference-normalizer";
import { DEFAULT_CAPTION_PREFERENCES } from "@shared/auth-types";

// Guards: a saved generated-local selection becomes Off without losing valid display settings or the model ID needed for explicit cleanup.
// Guards: an unsafe legacy model path is discarded while the generated-local selection still becomes unavailable and Off.
// Guards: platform and pre-source preferences retain valid enabled, language, and appearance values.
// Guards: malformed persisted caption fields cannot escape current safe defaults.
describe("normalizeNoDownloadCaptionPreferences", () => {
  it("disables a legacy local selection and preserves only its cleanup metadata", () => {
    expect(
      normalizeNoDownloadCaptionPreferences({
        enabled: true,
        source: "local",
        preferredLanguage: "es-MX",
        localModelId: "zipformer-en-20m-2023-02-17",
        textSizePercent: 125,
        backgroundOpacityPercent: 60,
      })
    ).toEqual({
      preferences: {
        enabled: false,
        source: "platform",
        preferredLanguage: "es-MX",
        localModelId: null,
        textSizePercent: 125,
        backgroundOpacityPercent: 60,
      },
      legacyLocalSelection: {
        sourceId: "legacy-local-caption",
        modelId: "zipformer-en-20m-2023-02-17",
        availability: {
          status: "unavailable",
          reason: "legacy-generated-disabled",
        },
      },
    });
  });

  it("discards an unsafe legacy model path while disabling the selection", () => {
    const normalized = normalizeNoDownloadCaptionPreferences({
      enabled: true,
      source: "local",
      preferredLanguage: "en",
      localModelId: "../outside-models",
      textSizePercent: 100,
      backgroundOpacityPercent: 80,
    });

    expect(normalized.preferences).toMatchObject({
      enabled: false,
      source: "platform",
      localModelId: null,
    });
    expect(normalized.legacyLocalSelection).toEqual({
      sourceId: "legacy-local-caption",
      modelId: null,
      availability: {
        status: "unavailable",
        reason: "legacy-generated-disabled",
      },
    });
  });

  it("preserves valid platform and pre-source preferences", () => {
    const settings = {
      enabled: true,
      preferredLanguage: "fr-CA",
      localModelId: null,
      textSizePercent: 150,
      backgroundOpacityPercent: 40,
    };
    const expected = {
      ...settings,
      source: "platform",
    };

    expect(normalizeNoDownloadCaptionPreferences({ ...settings, source: "platform" })).toEqual({
      preferences: expected,
      legacyLocalSelection: null,
    });
    expect(normalizeNoDownloadCaptionPreferences(settings)).toEqual({
      preferences: expected,
      legacyLocalSelection: null,
    });
  });

  it("returns safe defaults for malformed preferences", () => {
    expect(
      normalizeNoDownloadCaptionPreferences({
        enabled: "yes",
        source: "platform",
        preferredLanguage: "english",
        localModelId: "../outside-models",
        textSizePercent: Number.POSITIVE_INFINITY,
        backgroundOpacityPercent: 101,
      })
    ).toEqual({
      preferences: DEFAULT_CAPTION_PREFERENCES,
      legacyLocalSelection: null,
    });
  });
});
