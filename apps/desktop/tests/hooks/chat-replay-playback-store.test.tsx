import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import {
  type ChatReplayPlaybackStore,
  createChatReplayPlaybackStore,
  useChatReplayPlaybackSnapshot,
} from "@/hooks/chat-replay-playback-store";

describe("Chat Replay playback store", () => {
  it("updates the narrow replay subscriber without rerendering the Video owner", () => {
    let ownerRenders = 0;

    function ReplayBoundary({ store }: { store: ChatReplayPlaybackStore }) {
      const playback = useChatReplayPlaybackSnapshot(store);
      return <output>{playback.currentTime}</output>;
    }

    function VideoOwner() {
      ownerRenders += 1;
      const [store] = useState(createChatReplayPlaybackStore);
      return (
        <>
          <button
            type="button"
            onClick={() => store.publish({ currentTime: 42, isPlaying: true, playbackRate: 1.5 })}
          >
            timeupdate
          </button>
          <ReplayBoundary store={store} />
        </>
      );
    }

    render(<VideoOwner />);
    fireEvent.click(screen.getByRole("button", { name: "timeupdate" }));

    expect(screen.getByText("42")).toBeInTheDocument();
    expect(ownerRenders).toBe(1);
  });
});
