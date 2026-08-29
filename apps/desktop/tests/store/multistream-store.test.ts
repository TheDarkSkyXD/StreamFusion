import { beforeEach, describe, expect, it } from "vitest";

import {
  DEFAULT_BACKGROUND_QUALITY,
  DEFAULT_MULTIVIEW_CAP,
  MULTISTREAM_STORE_VERSION,
  MULTIVIEW_CAP_MAX,
  MULTIVIEW_CAP_MIN,
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
    multiviewCap: DEFAULT_MULTIVIEW_CAP,
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

  it("caps stream count at MultiviewCap (default 4)", () => {
    for (let i = 0; i < 8; i++) {
      useMultiStreamStore.getState().addStream("twitch", `channel${i}`);
    }
    expect(useMultiStreamStore.getState().streams).toHaveLength(DEFAULT_MULTIVIEW_CAP);
    expect(DEFAULT_MULTIVIEW_CAP).toBe(4);
  });

  it("honors a user-raised MultiviewCap when adding streams", () => {
    useMultiStreamStore.getState().setMultiviewCap(6);
    for (let i = 0; i < 8; i++) {
      useMultiStreamStore.getState().addStream("twitch", `channel${i}`);
    }
    expect(useMultiStreamStore.getState().streams).toHaveLength(6);
  });

  it("does not silently truncate when a request would exceed the cap", () => {
    useMultiStreamStore.getState().setMultiviewCap(2);
    useMultiStreamStore.getState().addStream("twitch", "a");
    useMultiStreamStore.getState().addStream("twitch", "b");
    const before = useMultiStreamStore.getState().streams.length;
    useMultiStreamStore.getState().addStream("twitch", "c");
    const after = useMultiStreamStore.getState().streams.length;
    // No silent truncation: the count stays at the cap, no slot was dropped or replaced.
    expect(before).toBe(2);
    expect(after).toBe(2);
    expect(useMultiStreamStore.getState().streams.map((s) => s.channelName)).toEqual(["a", "b"]);
  });
});

describe("multistream-store MultiviewCap", () => {
  it("defaults to 4 on a fresh store", () => {
    expect(useMultiStreamStore.getState().multiviewCap).toBe(DEFAULT_MULTIVIEW_CAP);
    expect(DEFAULT_MULTIVIEW_CAP).toBe(4);
  });

  it("exposes MULTIVIEW_CAP_MIN=1 and MULTIVIEW_CAP_MAX=6", () => {
    expect(MULTIVIEW_CAP_MIN).toBe(1);
    expect(MULTIVIEW_CAP_MAX).toBe(6);
  });

  it("setMultiviewCap clamps below the min", () => {
    useMultiStreamStore.getState().setMultiviewCap(0);
    expect(useMultiStreamStore.getState().multiviewCap).toBe(MULTIVIEW_CAP_MIN);
  });

  it("setMultiviewCap clamps above the max", () => {
    useMultiStreamStore.getState().setMultiviewCap(99);
    expect(useMultiStreamStore.getState().multiviewCap).toBe(MULTIVIEW_CAP_MAX);
  });

  it("setMultiviewCap accepts in-range values", () => {
    useMultiStreamStore.getState().setMultiviewCap(3);
    expect(useMultiStreamStore.getState().multiviewCap).toBe(3);
  });
});

describe("multistream-store BackgroundQuality default", () => {
  it("defaults to 'auto-low' on a fresh store", () => {
    expect(useMultiStreamStore.getState().backgroundQuality).toBe("auto-low");
    expect(DEFAULT_BACKGROUND_QUALITY).toBe("auto-low");
  });
});

describe("multistream-store schema migration", () => {
  it("uses persisted schema version 2", () => {
    expect(MULTISTREAM_STORE_VERSION).toBe(2);
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

    expect(migrated.multiviewCap).toBe(DEFAULT_MULTIVIEW_CAP);
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
      multiviewCap: 6,
      backgroundQuality: "match-source" as const,
    };
    const migrated = migrateMultiStreamState(current, MULTISTREAM_STORE_VERSION);
    expect(migrated.multiviewCap).toBe(6);
    expect(migrated.backgroundQuality).toBe("match-source");
  });

  it("migration clamps a corrupt out-of-range MultiviewCap to the valid range", () => {
    const corrupt = {
      streams: [],
      layout: "grid",
      isChatOpen: true,
      chatStreamId: null,
      multiviewCap: 42,
      backgroundQuality: "auto-low" as const,
    };
    const migrated = migrateMultiStreamState(corrupt, MULTISTREAM_STORE_VERSION);
    expect(migrated.multiviewCap).toBe(MULTIVIEW_CAP_MAX);
  });

  // Guards: persisted state is an untrusted boundary. Invalid nested entries
  // must be discarded before Zustand exposes them as typed application state.
  it("discards malformed persisted streams and favorites", () => {
    const migrated = migrateMultiStreamState(
      {
        streams: [
          { id: "kick-valid", platform: "kick", channelName: "valid", isMuted: false, volume: 0.5 },
          { id: "bad-platform", platform: "youtube", channelName: "bad", isMuted: false, volume: 0.5 },
          { id: "bad-volume", platform: "twitch", channelName: "bad", isMuted: false, volume: "loud" },
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
  it("setLayout changes the layout mode", () => {
    useMultiStreamStore.getState().setLayout("focus");
    expect(useMultiStreamStore.getState().layout).toBe("focus");
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
