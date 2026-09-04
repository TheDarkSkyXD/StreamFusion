import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BACKGROUND_QUALITY,
  DEFAULT_MULTIVIEW_PLAYBACK_BUDGET,
  MULTISTREAM_STORE_VERSION,
  MULTIVIEW_PLAYBACK_BUDGET_MIN,
  migrateMultiStreamState,
  useMultiStreamStore,
} from "@/features/multistream/data/multistream-store";

function resetStore() {
  useMultiStreamStore.setState({
    streams: [],
    favoriteStreams: [],
    layout: "grid",
    focusedStreamId: null,
    isChatOpen: true,
    chatStreamId: null,
    playbackBudget: DEFAULT_MULTIVIEW_PLAYBACK_BUDGET,
    backgroundQuality: DEFAULT_BACKGROUND_QUALITY,
  });
}

beforeEach(() => resetStore());

const favorite = {
  platform: "twitch",
  channelId: "stable-1",
  channelName: "streamer",
  displayName: "Streamer",
  avatarUrl: "https://example.com/streamer.png",
} as const;

// Guards: toggling an unfavorited MultiView channel saves it and makes the favorite lookup true.
// Guards: a missing stable channel ID falls back to a trimmed, case-insensitive platform-scoped channel name.
// Guards: non-empty stable channel IDs remain authoritative when two channels share a name.
// Guards: identical channel identities on Twitch and Kick remain separate MultiView favorites.
// Guards: saved MultiView favorites survive store rehydration.
describe("multistream-store favorite streams", () => {
  it("adds an unfavorited stream", () => {
    useMultiStreamStore.getState().toggleFavorite(favorite);

    expect(useMultiStreamStore.getState().favoriteStreams).toEqual([favorite]);
    expect(useMultiStreamStore.getState().isFavorite(favorite)).toBe(true);
  });

  it("removes an already-favorited stream", () => {
    useMultiStreamStore.getState().toggleFavorite(favorite);
    useMultiStreamStore.getState().toggleFavorite(favorite);

    expect(useMultiStreamStore.getState().favoriteStreams).toEqual([]);
    expect(useMultiStreamStore.getState().isFavorite(favorite)).toBe(false);
  });

  it("falls back to normalized channel name when a stable channel ID is unavailable", () => {
    const legacyFavorite = {
      ...favorite,
      channelId: "",
      channelName: " Streamer ",
    };
    const resolvedFavorite = {
      ...favorite,
      channelId: "stable-2",
      channelName: "STREAMER",
    };
    useMultiStreamStore.setState({ favoriteStreams: [legacyFavorite] });

    expect(useMultiStreamStore.getState().isFavorite(resolvedFavorite)).toBe(true);
    useMultiStreamStore.getState().toggleFavorite(resolvedFavorite);
    expect(useMultiStreamStore.getState().favoriteStreams).toEqual([]);
  });

  it("keeps same-name channels with different stable IDs distinct", () => {
    const differentChannel = { ...favorite, channelId: "stable-2" };

    useMultiStreamStore.getState().toggleFavorite(favorite);
    useMultiStreamStore.getState().toggleFavorite(differentChannel);

    expect(useMultiStreamStore.getState().favoriteStreams).toEqual([favorite, differentChannel]);
  });

  it("keeps matching channel identities on different platforms distinct", () => {
    const kickFavorite = { ...favorite, platform: "kick" as const };

    useMultiStreamStore.getState().toggleFavorite(favorite);
    useMultiStreamStore.getState().toggleFavorite(kickFavorite);

    expect(useMultiStreamStore.getState().favoriteStreams).toEqual([favorite, kickFavorite]);
  });

  it("restores saved favorites after rehydration", async () => {
    useMultiStreamStore.getState().toggleFavorite(favorite);
    const saved = localStorage.getItem("multistream-storage");

    useMultiStreamStore.setState({ favoriteStreams: [] });
    localStorage.setItem("multistream-storage", saved!);
    await useMultiStreamStore.persist.rehydrate();

    expect(useMultiStreamStore.getState().favoriteStreams).toEqual([favorite]);
  });
});

describe("multistream-store addStream", () => {
  it("adds a stream and auto-assigns chatStreamId when none is set", () => {
    useMultiStreamStore.getState().addStream("kick", "xqc");
    const s = useMultiStreamStore.getState();
    expect(s.streams).toHaveLength(1);
    expect(s.streams[0]).toMatchObject({
      id: "kick-xqc",
      platform: "kick",
      channelName: "xqc",
      isMuted: false,
      volume: 0.5,
    });
    expect(s.chatStreamId).toBe("kick-xqc");
  });

  it("auto-mutes subsequent streams", () => {
    useMultiStreamStore.getState().addStream("twitch", "first");
    useMultiStreamStore.getState().addStream("twitch", "second");
    const streams = useMultiStreamStore.getState().streams;
    expect(streams[0].isMuted).toBe(false);
    expect(streams[1].isMuted).toBe(true);
  });

  it("does not duplicate streams with the same id", () => {
    useMultiStreamStore.getState().addStream("kick", "xqc");
    useMultiStreamStore.getState().addStream("kick", "xqc");
    expect(useMultiStreamStore.getState().streams).toHaveLength(1);
  });

  it("does not duplicate streams whose channel names differ only by casing or whitespace", () => {
    useMultiStreamStore.getState().addStream("kick", "  XqC ");
    useMultiStreamStore.getState().addStream("kick", "xqc");

    expect(useMultiStreamStore.getState().streams).toEqual([
      expect.objectContaining({ id: "kick-xqc", channelName: "XqC" }),
    ]);
  });

  // Guards: layout membership remains unbounded while playback concurrency is budgeted separately.
  it("keeps every distinct stream beyond the default playback budget", () => {
    for (let i = 0; i < 8; i++) {
      useMultiStreamStore.getState().addStream("twitch", `channel${i}`);
    }
    expect(useMultiStreamStore.getState().streams).toHaveLength(8);
    expect(useMultiStreamStore.getState().playbackBudget).toBe(4);
  });
});

describe("multistream-store playback budget", () => {
  it("defaults to 4 on a fresh store", () => {
    expect(useMultiStreamStore.getState().playbackBudget).toBe(DEFAULT_MULTIVIEW_PLAYBACK_BUDGET);
    expect(DEFAULT_MULTIVIEW_PLAYBACK_BUDGET).toBe(4);
  });

  it("has a minimum of one decoder", () => {
    expect(MULTIVIEW_PLAYBACK_BUDGET_MIN).toBe(1);
  });

  it("clamps below the minimum", () => {
    useMultiStreamStore.getState().setPlaybackBudget(0);
    expect(useMultiStreamStore.getState().playbackBudget).toBe(MULTIVIEW_PLAYBACK_BUDGET_MIN);
  });

  it("accepts a user-selected budget without a hard maximum", () => {
    useMultiStreamStore.getState().setPlaybackBudget(99);
    expect(useMultiStreamStore.getState().playbackBudget).toBe(99);
  });
});

describe("multistream-store BackgroundQuality default", () => {
  it("defaults to 'auto-low' on a fresh store", () => {
    expect(useMultiStreamStore.getState().backgroundQuality).toBe("auto-low");
    expect(DEFAULT_BACKGROUND_QUALITY).toBe("auto-low");
  });
});

describe("multistream-store schema migration", () => {
  it("uses persisted schema version 5", () => {
    expect(MULTISTREAM_STORE_VERSION).toBe(5);
  });

  it("migrates a version 1 payload with no favorites to an empty favorites list", () => {
    const v1 = {
      streams: [],
      layout: "grid",
      isChatOpen: true,
      chatStreamId: null,
      multiviewCap: 4,
      backgroundQuality: "auto-low" as const,
    };

    expect(migrateMultiStreamState(v1, 1).favoriteStreams).toEqual([]);
  });

  it("migrates v0 fixture: seeds defaults without losing prior preferences", () => {
    // v0 fixture: the old persisted shape — no MultiviewCap, no BackgroundQuality,
    // and a `layout` that was hard-coded back to 'grid' on persist.
    const v0 = {
      streams: [
        { id: "kick-a", platform: "kick", channelName: "a", isMuted: false, volume: 0.5 },
        { id: "twitch-b", platform: "twitch", channelName: "b", isMuted: true, volume: 0.7 },
      ],
      layout: "grid",
      isChatOpen: false,
      chatStreamId: "kick-a",
    };

    const migrated = migrateMultiStreamState(v0, 0);

    expect(migrated.playbackBudget).toBe(DEFAULT_MULTIVIEW_PLAYBACK_BUDGET);
    expect(migrated.backgroundQuality).toBe(DEFAULT_BACKGROUND_QUALITY);
    expect(migrated.streams).toEqual(v0.streams);
    expect(migrated.isChatOpen).toBe(false);
    expect(migrated.chatStreamId).toBe("kick-a");
  });

  it("migration leaves already-current values untouched", () => {
    const current = {
      streams: [],
      layout: "grid",
      isChatOpen: true,
      chatStreamId: null,
      playbackBudget: 6,
      backgroundQuality: "match-source" as const,
    };
    const migrated = migrateMultiStreamState(current, MULTISTREAM_STORE_VERSION);
    expect(migrated.playbackBudget).toBe(6);
    expect(migrated.backgroundQuality).toBe("match-source");
    expect(migrated.multiChatView).toBe("merged");
  });

  it("preserves the selected multi-chat presentation", () => {
    expect(migrateMultiStreamState({ multiChatView: "tabs" }, 4).multiChatView).toBe("tabs");
    expect(migrateMultiStreamState({ multiChatView: "invalid" }, 4).multiChatView).toBe("merged");
  });

  it("repairs a tabs view whose selected stream was not persisted", () => {
    const migrated = migrateMultiStreamState(
      {
        streams: [
          {
            id: "twitch-cinna",
            platform: "twitch",
            channelName: "cinna",
            isMuted: false,
            volume: 0.5,
          },
        ],
        multiChatView: "tabs",
      },
      5
    );

    expect(migrated.chatStreamId).toBe("twitch-cinna");
  });

  it("canonicalizes and deduplicates persisted stream identities", () => {
    const migrated = migrateMultiStreamState(
      {
        streams: [
          {
            id: "kick-XqC",
            platform: "kick",
            channelName: " XqC ",
            isMuted: false,
            volume: 0.5,
          },
          {
            id: "kick-xqc",
            platform: "kick",
            channelName: "xqc",
            isMuted: true,
            volume: 0.7,
          },
        ],
        chatStreamId: "kick-XqC",
      },
      3
    );

    expect(migrated.streams).toEqual([
      { id: "kick-xqc", platform: "kick", channelName: "XqC", isMuted: false, volume: 0.5 },
    ]);
    expect(migrated.chatStreamId).toBe("kick-xqc");
  });

  it("migrates the legacy cap into an uncapped playback budget", () => {
    const corrupt = {
      streams: [],
      layout: "grid",
      isChatOpen: true,
      chatStreamId: null,
      multiviewCap: 42,
      backgroundQuality: "auto-low" as const,
    };
    const migrated = migrateMultiStreamState(corrupt, MULTISTREAM_STORE_VERSION);
    expect(migrated.playbackBudget).toBe(42);
  });

  // Guards: persisted state is an untrusted boundary. Invalid nested entries
  // must be discarded before Zustand exposes them as typed application state.
  it("discards malformed persisted streams and favorites", () => {
    const migrated = migrateMultiStreamState(
      {
        streams: [
          { id: "kick-valid", platform: "kick", channelName: "valid", isMuted: false, volume: 0.5 },
          {
            id: "bad-platform",
            platform: "youtube",
            channelName: "bad",
            isMuted: false,
            volume: 0.5,
          },
          {
            id: "bad-volume",
            platform: "twitch",
            channelName: "bad",
            isMuted: false,
            volume: "loud",
          },
        ],
        favoriteStreams: [
          { platform: "twitch", channelId: "1", channelName: "valid", displayName: "Valid" },
          { platform: "kick", channelId: 2, channelName: "bad", displayName: "Bad" },
        ],
      },
      MULTISTREAM_STORE_VERSION
    );

    expect(migrated.streams).toEqual([
      { id: "kick-valid", platform: "kick", channelName: "valid", isMuted: false, volume: 0.5 },
    ]);
    expect(migrated.favoriteStreams).toEqual([
      { platform: "twitch", channelId: "1", channelName: "valid", displayName: "Valid" },
    ]);
  });

  it("does not overwrite chatStreamId when one is already set", () => {
    useMultiStreamStore.getState().addStream("kick", "first");
    useMultiStreamStore.getState().addStream("kick", "second");
    expect(useMultiStreamStore.getState().chatStreamId).toBe("kick-first");
  });
});

describe("multistream-store removeStream", () => {
  it("removes a stream by id", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().addStream("kick", "b");
    useMultiStreamStore.getState().removeStream("kick-a");
    expect(useMultiStreamStore.getState().streams.map((s) => s.id)).toEqual(["kick-b"]);
  });

  it("reassigns chatStreamId to first remaining stream when the chat stream is removed", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().addStream("kick", "b");
    expect(useMultiStreamStore.getState().chatStreamId).toBe("kick-a");
    useMultiStreamStore.getState().removeStream("kick-a");
    expect(useMultiStreamStore.getState().chatStreamId).toBe("kick-b");
  });

  it("nulls chatStreamId when the last stream is removed", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().removeStream("kick-a");
    expect(useMultiStreamStore.getState().chatStreamId).toBeNull();
  });

  it("clears focusedStreamId when the focused stream is removed", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().setFocusedStream("kick-a");
    useMultiStreamStore.getState().removeStream("kick-a");
    expect(useMultiStreamStore.getState().focusedStreamId).toBeNull();
  });
});

describe("multistream-store updateStream", () => {
  it("merges partial updates into the targeted stream", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().updateStream("kick-a", { volume: 0.8 });
    expect(useMultiStreamStore.getState().streams[0].volume).toBe(0.8);
  });

  it("does not affect other streams", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().addStream("kick", "b");
    useMultiStreamStore.getState().updateStream("kick-a", { volume: 0.1 });
    expect(useMultiStreamStore.getState().streams[1].volume).toBe(0.5);
  });
});

describe("multistream-store reorderStreams", () => {
  it("moves a stream from one index to another", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().addStream("kick", "b");
    useMultiStreamStore.getState().addStream("kick", "c");
    useMultiStreamStore.getState().reorderStreams(0, 2);
    expect(useMultiStreamStore.getState().streams.map((s) => s.channelName)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });
});

describe("multistream-store clearStreams", () => {
  it("empties all streams and resets chat/focused ids", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().addStream("kick", "b");
    useMultiStreamStore.getState().setFocusedStream("kick-a");
    useMultiStreamStore.getState().clearStreams();
    const s = useMultiStreamStore.getState();
    expect(s.streams).toEqual([]);
    expect(s.chatStreamId).toBeNull();
    expect(s.focusedStreamId).toBeNull();
  });
});

describe("multistream-store layout", () => {
  // Guards: entering focus layout always selects a real stream so the toolbar action cannot render the grid unchanged.
  it("setLayout selects the first stream when entering focus mode", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().addStream("twitch", "b");

    useMultiStreamStore.getState().setLayout("focus");

    expect(useMultiStreamStore.getState().layout).toBe("focus");
    expect(useMultiStreamStore.getState().focusedStreamId).toBe("kick-a");
  });

  it("setFocusedStream switches to focus layout", () => {
    useMultiStreamStore.getState().setFocusedStream("kick-a");
    expect(useMultiStreamStore.getState().layout).toBe("focus");
    expect(useMultiStreamStore.getState().focusedStreamId).toBe("kick-a");
  });

  it("setFocusedStream(null) switches back to grid layout", () => {
    useMultiStreamStore.getState().setFocusedStream("kick-a");
    useMultiStreamStore.getState().setFocusedStream(null);
    expect(useMultiStreamStore.getState().layout).toBe("grid");
    expect(useMultiStreamStore.getState().focusedStreamId).toBeNull();
  });
});

describe("multistream-store chat", () => {
  it("toggleChat flips isChatOpen", () => {
    expect(useMultiStreamStore.getState().isChatOpen).toBe(true);
    useMultiStreamStore.getState().toggleChat();
    expect(useMultiStreamStore.getState().isChatOpen).toBe(false);
    useMultiStreamStore.getState().toggleChat();
    expect(useMultiStreamStore.getState().isChatOpen).toBe(true);
  });

  it("setChatStream sets the active chat stream", () => {
    useMultiStreamStore.getState().setChatStream("kick-a");
    expect(useMultiStreamStore.getState().chatStreamId).toBe("kick-a");
  });

  it("selects the first stream when tabs mode has no valid selection", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.setState({ chatStreamId: null });

    useMultiStreamStore.getState().setMultiChatView("tabs");

    expect(useMultiStreamStore.getState().chatStreamId).toBe("kick-a");
  });
});

describe("multistream-store audio", () => {
  it("toggleMute flips the muted state of a stream", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    expect(useMultiStreamStore.getState().streams[0].isMuted).toBe(false);
    useMultiStreamStore.getState().toggleMute("kick-a");
    expect(useMultiStreamStore.getState().streams[0].isMuted).toBe(true);
    useMultiStreamStore.getState().toggleMute("kick-a");
    expect(useMultiStreamStore.getState().streams[0].isMuted).toBe(false);
  });

  it("setVolume sets the volume of a specific stream", () => {
    useMultiStreamStore.getState().addStream("kick", "a");
    useMultiStreamStore.getState().setVolume("kick-a", 0.9);
    expect(useMultiStreamStore.getState().streams[0].volume).toBe(0.9);
  });
});

// Guards: a raid replaces only its source slot while preserving order, mute, volume, focus, and chat selection.
// Guards: a raid target already open in MultiView is focused and merged instead of duplicated.
describe("multistream-store outgoing raid replacement", () => {
  it("replaces the matching slot atomically", () => {
    useMultiStreamStore.getState().addStream("twitch", "alpha");
    useMultiStreamStore.getState().addStream("kick", "beta");
    useMultiStreamStore.getState().updateStream("twitch-alpha", { isMuted: true, volume: 0.73 });
    useMultiStreamStore.getState().setFocusedStream("twitch-alpha");
    useMultiStreamStore.getState().setChatStream("twitch-alpha");

    const result = useMultiStreamStore.getState().replaceRaidSource("twitch-alpha", {
      platform: "twitch",
      channelSlug: "gamma",
      displayName: "Gamma",
    });

    expect(result).toEqual({ kind: "replaced", targetStreamId: "twitch-gamma", wasFocused: true });
    expect(useMultiStreamStore.getState()).toMatchObject({
      streams: [{ id: "twitch-gamma", isMuted: true, volume: 0.73 }, { id: "kick-beta" }],
      focusedStreamId: "twitch-gamma",
      chatStreamId: "twitch-gamma",
    });
  });

  it("merges into an existing target and remaps focus and chat", () => {
    useMultiStreamStore.getState().addStream("twitch", "alpha");
    useMultiStreamStore.getState().addStream("twitch", "gamma");
    useMultiStreamStore.getState().setFocusedStream("twitch-alpha");
    useMultiStreamStore.getState().setChatStream("twitch-alpha");

    const result = useMultiStreamStore.getState().replaceRaidSource("twitch-alpha", {
      platform: "twitch",
      channelSlug: "gamma",
      displayName: "Gamma",
    });

    expect(result).toEqual({
      kind: "merged-existing",
      targetStreamId: "twitch-gamma",
      removedSourceId: "twitch-alpha",
      wasFocused: true,
    });
    expect(useMultiStreamStore.getState().streams.map((stream) => stream.id)).toEqual([
      "twitch-gamma",
    ]);
    expect(useMultiStreamStore.getState().focusedStreamId).toBe("twitch-gamma");
    expect(useMultiStreamStore.getState().chatStreamId).toBe("twitch-gamma");
  });
});
