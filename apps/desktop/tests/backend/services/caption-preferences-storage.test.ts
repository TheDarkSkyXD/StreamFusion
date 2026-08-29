import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

vi.mock("electron-store", () => ({
  default: class MockStore {
    private data: Record<string, unknown>;

    constructor(options: { defaults?: Record<string, unknown> } = {}) {
      this.data = { ...options.defaults };
    }

    get(key: string, fallback?: unknown) {
      return key in this.data ? this.data[key] : fallback;
    }

    set(key: string, value: unknown) {
      this.data[key] = value;
    }

    get store() {
      return { ...this.data };
    }

    set store(value: Record<string, unknown>) {
      this.data = { ...value };
    }
  },
}));

vi.mock("@backend/services/database-service", () => ({
  dbService: {
    migrateKeyValues: vi.fn(),
  },
}));

import { storageService } from "@backend/services/storage-service";
import { DEFAULT_USER_PREFERENCES } from "@shared/auth-types";

// Guards: logical caption source, model, language, enabled state, and appearance survive durable preference round-trips.
// Guards: older or malformed caption preferences hydrate to safe defaults without overwriting unrelated preferences.
// Guards: transient platform track keys and signed media URLs never enter durable preferences.
describe("caption preference storage", () => {
  beforeEach(() => {
    storageService.initialize();
    const { captions: _captions, ...legacyPreferences } = DEFAULT_USER_PREFERENCES;
    storageService.updatePreferences(legacyPreferences as typeof DEFAULT_USER_PREFERENCES);
  });

  it("hydrates and round-trips logical source, model, language, enabled state, and appearance", () => {
    expect(storageService.getPreferences().captions).toEqual({
      enabled: false,
      source: "platform",
      preferredLanguage: null,
      localModelId: null,
      textSizePercent: 100,
      backgroundOpacityPercent: 80,
    });

    const captions = {
      enabled: true,
      source: "local" as const,
      preferredLanguage: "en-US",
      localModelId: "zipformer-en-20m-2023-02-17",
      textSizePercent: 150,
      backgroundOpacityPercent: 40,
    };
    storageService.updatePreferences({ captions });

    expect(storageService.getPreferences().captions).toEqual(captions);
  });

  it("uses safe defaults for malformed legacy caption values and preserves unrelated preferences", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      theme: "light",
      playback: { ...DEFAULT_USER_PREFERENCES.playback, volume: 0.25 },
      captions: {
        enabled: "true",
        source: "platform-track:english-1",
        preferredLanguage: "platform:twitch:english-1",
        localModelId: "track:twitch:model-1",
        textSizePercent: 999,
        backgroundOpacityPercent: -1,
      },
    } as unknown as typeof DEFAULT_USER_PREFERENCES);

    const hydrated = storageService.getPreferences();

    expect(hydrated.captions).toEqual({
      enabled: false,
      source: "platform",
      preferredLanguage: null,
      localModelId: null,
      textSizePercent: 100,
      backgroundOpacityPercent: 80,
    });
    expect(hydrated.theme).toBe("light");
    expect(hydrated.playback.volume).toBe(0.25);
  });

  it("migrates the previous caption shape without losing its enabled, language, or appearance", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      captions: {
        enabled: true,
        preferredLanguage: "es-MX",
        textSizePercent: 175,
        backgroundOpacityPercent: 30,
      },
    } as unknown as typeof DEFAULT_USER_PREFERENCES);

    expect(storageService.getPreferences().captions).toEqual({
      enabled: true,
      source: "platform",
      preferredLanguage: "es-MX",
      localModelId: null,
      textSizePercent: 175,
      backgroundOpacityPercent: 30,
    });
  });

  it("stores only logical caption selection fields and preserves unrelated preference fields", () => {
    storageService.updatePreferences({
      ...DEFAULT_USER_PREFERENCES,
      theme: "light",
      chat: { ...DEFAULT_USER_PREFERENCES.chat, fontScale: 1.25 },
    });
    const logicalCaptions = {
      enabled: true,
      source: "local" as const,
      preferredLanguage: "en",
      localModelId: "zipformer-en-20m-2023-02-17",
      textSizePercent: 125,
      backgroundOpacityPercent: 60,
    };

    storageService.updatePreferences({
      captions: {
        ...logicalCaptions,
        trackKey: "platform:twitch:english-123",
        signedUrl: "https://video.example.test/captions.vtt?token=secret",
        phase: "ready",
        error: "transient recognizer error",
        downloadedBytes: 45_202_074,
        sessionId: "stream-session-123",
      } as typeof logicalCaptions,
    });

    const persisted = storageService.getPreferences();
    if (!persisted || typeof persisted !== "object") {
      throw new Error("Expected persisted preferences");
    }
    if (!("captions" in persisted) || !("theme" in persisted) || !("chat" in persisted)) {
      throw new Error("Persisted preferences are missing required fields");
    }
    if (!persisted.chat || typeof persisted.chat !== "object" || !("fontScale" in persisted.chat)) {
      throw new Error("Persisted chat preferences are missing fontScale");
    }
    expect(persisted.captions).toEqual(logicalCaptions);
    expect(persisted.theme).toBe("light");
    expect(persisted.chat.fontScale).toBe(1.25);
  });
});
