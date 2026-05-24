import { describe, expect, it } from "vitest";

import {
  type BufferPreferences,
  type ChatDisplayPreferences,
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PREDICTION_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type PlaybackAdvancedPreferences,
  type PlayerControlsPreferences,
  type PredictionPreferences,
  type ProxyPreferences,
  type UserPreferences,
} from "@/shared/auth-types";

describe("PredictionPreferences defaults (U1)", () => {
  it("defaults predictions.style to 'native'", () => {
    expect(DEFAULT_USER_PREFERENCES.predictions.style).toBe("native");
    expect(DEFAULT_PREDICTION_PREFERENCES.style).toBe("native");
  });

  it("includes predictions on the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: predictions is a required field. If U1 forgot to wire
    // predictions into UserPreferences, this assignment would fail to compile.
    const style: PredictionPreferences["style"] = prefs.predictions.style;
    expect(style).toBe("native");
  });

  it("accepts 'unified' as a valid style", () => {
    const unifiedPrefs: PredictionPreferences = { style: "unified" };
    expect(unifiedPrefs.style).toBe("unified");
  });
});

describe("ChatDisplayPreferences defaults (U1)", () => {
  it("defaults messageLimit to the shipped RAM-safe cap of 100 (not the origin's 500/150)", () => {
    // Guards the U4 reconciliation: raising this regresses the 5 GB-spike fix.
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit).toBe(100);
    expect(DEFAULT_USER_PREFERENCES.chatDisplay.messageLimit).toBe(100);
  });

  it("wires chatDisplay onto the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: chatDisplay is a required field. If U1 forgot to wire it
    // into UserPreferences, this assignment would fail to compile.
    const display: ChatDisplayPreferences = prefs.chatDisplay;
    expect(display).toBe(DEFAULT_CHAT_DISPLAY_PREFERENCES);
  });

  it("defaults appearance + emote/event toggles to sensible desktop values", () => {
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.timestamps).toBe(false);
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.timestampFormat).toBe("HH:mm");
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.density).toBe("cozy");
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.fontSizePx).toBe(13);
    // Emote providers + event surfaces are on by default.
    for (const on of [
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enable7tv,
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enableBttv,
      DEFAULT_CHAT_DISPLAY_PREFERENCES.enableFfz,
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showPolls,
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showPredictions,
      DEFAULT_CHAT_DISPLAY_PREFERENCES.showUserNotices,
    ]) {
      expect(on).toBe(true);
    }
  });

  it("hydrates the whole chatDisplay group for installs predating it (shallow top-level merge)", () => {
    // Mirrors storageService.getPreferences: `{ ...DEFAULT_USER_PREFERENCES, ...stored }`.
    // A persisted prefs object from before chatDisplay existed has no such key,
    // so the spread falls back to the full default group rather than `undefined`.
    const legacyStored: Partial<UserPreferences> = {
      theme: "dark",
      language: "en",
    };
    const hydrated = { ...DEFAULT_USER_PREFERENCES, ...legacyStored };
    expect(hydrated.chatDisplay).toEqual(DEFAULT_CHAT_DISPLAY_PREFERENCES);
    expect(hydrated.chatDisplay.messageLimit).toBe(100);
  });
});

describe("PlayerControlsPreferences defaults (U8)", () => {
  it("defaults every player control to visible", () => {
    for (const visible of [
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showQuality,
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showPlaybackSpeed,
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showVolume,
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showFullscreen,
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showTheater,
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showPictureInPicture,
      DEFAULT_PLAYER_CONTROLS_PREFERENCES.showVideoStats,
    ]) {
      expect(visible).toBe(true);
    }
  });

  it("wires playerControls onto the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: playerControls is a required field. If U8 forgot to wire
    // it into UserPreferences, this assignment would fail to compile.
    const controls: PlayerControlsPreferences = prefs.playerControls;
    expect(controls).toBe(DEFAULT_PLAYER_CONTROLS_PREFERENCES);
  });

  it("hydrates the whole playerControls group for installs predating it (shallow top-level merge)", () => {
    // Mirrors storageService.getPreferences: `{ ...DEFAULT_USER_PREFERENCES, ...stored }`.
    // A persisted prefs object from before playerControls existed has no such key,
    // so the spread falls back to the full default group rather than `undefined`.
    const legacyStored: Partial<UserPreferences> = {
      theme: "dark",
      language: "en",
    };
    const hydrated = { ...DEFAULT_USER_PREFERENCES, ...legacyStored };
    expect(hydrated.playerControls).toEqual(DEFAULT_PLAYER_CONTROLS_PREFERENCES);
    expect(hydrated.playerControls.showVolume).toBe(true);
  });
});

describe("BufferPreferences defaults (U10)", () => {
  it("defaults equal the values previously hardcoded in both player files (no behavior change)", () => {
    // R17: untouched install must build an identical HLS config. These four are
    // exactly the constants that lived in twitch-hls-player.tsx / hls-player.tsx.
    expect(DEFAULT_BUFFER_PREFERENCES).toEqual({
      lowLatencyMode: true,
      liveSyncDurationCount: 2,
      maxBufferLengthSec: 15,
      maxMaxBufferLengthSec: 30,
    });
    expect(DEFAULT_USER_PREFERENCES.buffer).toBe(DEFAULT_BUFFER_PREFERENCES);
  });

  it("wires buffer onto the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: buffer is a required field. If U10 forgot to wire it into
    // UserPreferences, this assignment would fail to compile.
    const buffer: BufferPreferences = prefs.buffer;
    expect(buffer).toBe(DEFAULT_BUFFER_PREFERENCES);
  });

  it("hydrates the whole buffer group for installs predating it (shallow top-level merge)", () => {
    // Mirrors storageService.getPreferences: `{ ...DEFAULT_USER_PREFERENCES, ...stored }`.
    // A persisted prefs object from before buffer existed has no such key, so the
    // spread falls back to the full default group rather than `undefined`.
    const legacyStored: Partial<UserPreferences> = {
      theme: "dark",
      language: "en",
    };
    const hydrated = { ...DEFAULT_USER_PREFERENCES, ...legacyStored };
    expect(hydrated.buffer).toEqual(DEFAULT_BUFFER_PREFERENCES);
    expect(hydrated.buffer.liveSyncDurationCount).toBe(2);
  });
});

describe("ProxyPreferences defaults (U11)", () => {
  it("is off by default with an empty host (safe no-op on fresh install, R21)", () => {
    expect(DEFAULT_PROXY_PREFERENCES.enabled).toBe(false);
    expect(DEFAULT_PROXY_PREFERENCES.host).toBe("");
    expect(DEFAULT_PROXY_PREFERENCES.port).toBeNull();
    expect(DEFAULT_PROXY_PREFERENCES.hasCredentials).toBe(false);
    expect(DEFAULT_USER_PREFERENCES.proxy).toBe(DEFAULT_PROXY_PREFERENCES);
  });

  it("carries NO password field — credentials live in safeStorage, not prefs", () => {
    // Security invariant: the prefs group (which PREFERENCES_GET returns to the
    // renderer) must never contain a password/secret. Assert the key set.
    expect(Object.keys(DEFAULT_PROXY_PREFERENCES).sort()).toEqual([
      "enabled",
      "hasCredentials",
      "host",
      "port",
    ]);
    expect(DEFAULT_PROXY_PREFERENCES).not.toHaveProperty("password");
    expect(DEFAULT_PROXY_PREFERENCES).not.toHaveProperty("username");
  });

  it("carries no per-class flags (setProxy is session-level — spike finding)", () => {
    // The egress spike proved per-class selectivity is not achievable via
    // session.setProxy. Pin that the type stays honest (no proxyToken/
    // proxyPlaylist/etc. flags that wouldn't function).
    const keys = Object.keys(DEFAULT_PROXY_PREFERENCES);
    expect(keys.some((k) => /class|playlist|token|media|multivariant/i.test(k))).toBe(false);
  });

  it("wires proxy onto the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: proxy is a required field. If U11 forgot to wire it into
    // UserPreferences, this assignment would fail to compile.
    const proxy: ProxyPreferences = prefs.proxy;
    expect(proxy).toBe(DEFAULT_PROXY_PREFERENCES);
  });

  it("hydrates the whole proxy group for installs predating it (shallow top-level merge)", () => {
    // Mirrors storageService.getPreferences: `{ ...DEFAULT_USER_PREFERENCES, ...stored }`.
    const legacyStored: Partial<UserPreferences> = {
      theme: "dark",
      language: "en",
    };
    const hydrated = { ...DEFAULT_USER_PREFERENCES, ...legacyStored };
    expect(hydrated.proxy).toEqual(DEFAULT_PROXY_PREFERENCES);
    expect(hydrated.proxy.enabled).toBe(false);
  });
});

describe("PlaybackAdvancedPreferences defaults (U13)", () => {
  it("defaults reproduce the current ad-block token behavior (behavior-neutral, R25)", () => {
    // playerType "default" = no override (ad-block keeps its own player-type list);
    // allowHevc false = DEFAULT_ADBLOCK_CONFIG.skipPlayerReloadOnHevc (HEVC→AVC swap).
    expect(DEFAULT_PLAYBACK_ADVANCED_PREFERENCES).toEqual({
      playerType: "default",
      allowHevc: false,
    });
    expect(DEFAULT_USER_PREFERENCES.playbackAdvanced).toBe(DEFAULT_PLAYBACK_ADVANCED_PREFERENCES);
  });

  it("wires playbackAdvanced onto the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    // Type-level check: playbackAdvanced is a required field. If U13 forgot to
    // wire it into UserPreferences, this assignment would fail to compile.
    const advanced: PlaybackAdvancedPreferences = prefs.playbackAdvanced;
    expect(advanced).toBe(DEFAULT_PLAYBACK_ADVANCED_PREFERENCES);
  });

  it("hydrates the whole playbackAdvanced group for installs predating it (shallow merge)", () => {
    // Mirrors storageService.getPreferences: `{ ...DEFAULT_USER_PREFERENCES, ...stored }`.
    const legacyStored: Partial<UserPreferences> = {
      theme: "dark",
      language: "en",
    };
    const hydrated = { ...DEFAULT_USER_PREFERENCES, ...legacyStored };
    expect(hydrated.playbackAdvanced).toEqual(DEFAULT_PLAYBACK_ADVANCED_PREFERENCES);
    expect(hydrated.playbackAdvanced.playerType).toBe("default");
  });

  it("shallow-merges a partial playbackAdvanced write without dropping siblings", () => {
    // The Settings write idiom spreads the current group then overrides one field.
    const merged: PlaybackAdvancedPreferences = {
      ...DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
      allowHevc: true,
    };
    expect(merged.allowHevc).toBe(true);
    // Sibling preserved.
    expect(merged.playerType).toBe("default");
  });
});
