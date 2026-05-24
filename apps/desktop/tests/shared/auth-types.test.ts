import { describe, expect, it } from "vitest";

import {
  type ChatDisplayPreferences,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PREDICTION_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type PlayerControlsPreferences,
  type PredictionPreferences,
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
