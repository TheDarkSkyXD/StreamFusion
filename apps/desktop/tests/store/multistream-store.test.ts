import { beforeEach, describe, expect, it } from "vitest";

import { useMultiStreamStore } from "@/store/multistream-store";

function resetStore() {
  useMultiStreamStore.setState({
    streams: [],
    layout: "grid",
    focusedStreamId: null,
    isChatOpen: true,
    chatStreamId: null,
  });
}

beforeEach(() => resetStore());

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

  it("caps at 6 streams", () => {
    for (let i = 0; i < 8; i++) {
      useMultiStreamStore.getState().addStream("twitch", `channel${i}`);
    }
    expect(useMultiStreamStore.getState().streams).toHaveLength(6);
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
