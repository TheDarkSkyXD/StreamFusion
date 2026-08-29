import { describe, expect, it } from "vitest";

import {
  type BufferPreferences,
  type ChatDensity,
  type ChatDisplayPreferences,
  DEFAULT_BUFFER_PREFERENCES,
  DEFAULT_CHAT_DISPLAY_PREFERENCES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  DEFAULT_PLAYBACK_ADVANCED_PREFERENCES,
  DEFAULT_PLAYER_CONTROLS_PREFERENCES,
  DEFAULT_PREDICTION_PREFERENCES,
  DEFAULT_PROXY_PREFERENCES,
  DEFAULT_USER_PREFERENCES,
  type NotificationPreferences,
  type PlaybackPreferences,
  type PlaybackAdvancedPreferences,
  type PlayerControlsPreferences,
  type PredictionPreferences,
  type ProxyPreferences,
  TWITCH_APP_SCOPES,
  TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES,
  TWITCH_MOD_ACTION_SCOPES,
  type UserPreferences,
  type VideoQuality,
} from "@shared/auth-types";

// Guards: Twitch OAuth scope constants are the canonical connect/reconnect list,
// so duplicates or a mod subset outside the app set would cause repeated consent prompts.
describe("Twitch OAuth scope constants", () => {
  it("contains every canonical read permission used by profile and moderation surfaces", () => {
    expect(TWITCH_APP_SCOPES).toEqual(
      expect.arrayContaining([
        "moderator:read:followers",
        "moderator:read:blocked_terms",
        "moderator:read:chat_settings",
        "moderator:read:moderators",
        "moderator:read:vips",
      ])
    );
  });

  it("contains no duplicate app scopes", () => {
    expect(new Set(TWITCH_APP_SCOPES).size).toBe(TWITCH_APP_SCOPES.length);
  });

  it("keeps the mod-action subset inside the full app scope set", () => {
    const appScopes = new Set(TWITCH_APP_SCOPES);
    for (const scope of TWITCH_MOD_ACTION_SCOPES) {
      expect(appScopes.has(scope)).toBe(true);
    }
  });

  it("keeps every channel.moderate EventSub scope inside the canonical app set", () => {
    expect(TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES).toEqual([
      "moderator:read:blocked_terms",
      "moderator:read:chat_settings",
      "moderator:read:unban_requests",
      "moderator:manage:banned_users",
      "moderator:manage:chat_messages",
      "moderator:manage:warnings",
      "moderator:read:moderators",
      "moderator:read:vips",
    ]);

    const appScopes = new Set(TWITCH_APP_SCOPES);
    for (const scope of TWITCH_CHANNEL_MODERATE_EVENTSUB_SCOPES) {
      expect(appScopes.has(scope)).toBe(true);
    }
  });
});

// Guards: Live Notification preferences must remain notify-by-default while restart grace stays opt-in.
describe("NotificationPreferences defaults", () => {
  it("defaults every live-notification source on except favorites-only and restart grace", () => {
    expect(DEFAULT_NOTIFICATION_PREFERENCES).toEqual({
      enabled: true,
      liveAlerts: true,
      twitch: true,
      kick: true,
      guestFollows: true,
      toastAlerts: true,
      sound: true,
      favoriteChannelsOnly: false,
      restartGracePeriodMinutes: 0,
      perChannelNotifications: {},
    });
    expect(DEFAULT_USER_PREFERENCES.notifications).toBe(DEFAULT_NOTIFICATION_PREFERENCES);
  });

  it("wires notifications onto the top-level UserPreferences shape", () => {
    const prefs: UserPreferences = DEFAULT_USER_PREFERENCES;
    const notifications: NotificationPreferences = prefs.notifications;
    expect(notifications).toBe(DEFAULT_NOTIFICATION_PREFERENCES);
  });
});

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

// Guards: Highest remains a persisted playback preset while fresh installs retain Auto.
describe("PlaybackPreferences quality presets", () => {
  it("round-trips Highest without changing the fresh-install Auto default", () => {
    const quality: VideoQuality = "highest";
    const persisted: PlaybackPreferences = {
      ...DEFAULT_USER_PREFERENCES.playback,
      defaultQuality: quality,
    };
    const hydrated = JSON.parse(JSON.stringify(persisted)) as PlaybackPreferences;

    expect(hydrated.defaultQuality).toBe("highest");
    expect(DEFAULT_USER_PREFERENCES.playback.defaultQuality).toBe("auto");
  });
});

// Guards: third-party badge and 7TV paint cosmetics remain independently enabled by default.
describe("ChatDisplayPreferences defaults (U1)", () => {
  it("accepts persisted Tight and Medium densities plus the Loose quick-appearance choice", () => {
    const densityValues: ChatDensity[] = ["compact", "cozy", "loose"];
    expect(densityValues).toEqual(["compact", "cozy", "loose"]);
  });

  it("defaults chatWidthPx to the Medium quick-appearance width", () => {
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.chatWidthPx).toBe(340);
    expect(DEFAULT_USER_PREFERENCES.chatDisplay.chatWidthPx).toBe(340);
  });

  it("enables smooth message hover by default", () => {
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.hoverSmooth).toBe(true);
    expect(DEFAULT_USER_PREFERENCES.chatDisplay.hoverSmooth).toBe(true);
  });

  it("shows quick emotes by default", () => {
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.quickEmotes).toBe(true);
    expect(DEFAULT_USER_PREFERENCES.chatDisplay.quickEmotes).toBe(true);
  });

  it("defaults messageLimit to 600 (the per-channel cap from PRD #62's chat-store dual-shape migration)", () => {
    // Was 100 in the flat-array era to defend the 5 GB-spike fix. The
    // per-channel store (commit b9f92f1 / .scratch grill notes) puts the
    // cap on each channelKey bucket independently — 4-panel multiview
    // worst case ≈ 4 × 600 × 500B ≈ 1.2 MB, well under the spike threshold.
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.messageLimit).toBe(600);
    expect(DEFAULT_USER_PREFERENCES.chatDisplay.messageLimit).toBe(600);
  });

  it("defaults recentMessagesLimit to 200", () => {
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.recentMessagesLimit).toBe(200);
    expect(DEFAULT_USER_PREFERENCES.chatDisplay.recentMessagesLimit).toBe(200);
  });

  it("enables each third-party badge and 7TV username paint preference by default", () => {
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES).toMatchObject({
      enable7tvBadges: true,
      enable7tvUsernamePaints: true,
      enableBttvBadges: true,
      enableFfzBadges: true,
    });
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
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.fontSizePx).toBe(16);
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.emoteSizePx).toBe(28);
    expect(DEFAULT_CHAT_DISPLAY_PREFERENCES.showTwitchPinDurationDialog).toBe(true);
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
    expect(hydrated.chatDisplay.messageLimit).toBe(600);
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
  it("defaults favor playback stability with a bounded live buffer", () => {
    expect(DEFAULT_BUFFER_PREFERENCES).toEqual({
      lowLatencyMode: false,
      liveSyncDurationCount: 4,
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
    expect(hydrated.buffer.liveSyncDurationCount).toBe(4);
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
