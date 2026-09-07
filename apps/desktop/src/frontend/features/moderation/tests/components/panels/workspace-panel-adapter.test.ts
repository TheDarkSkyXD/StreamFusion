import { beforeEach, describe, expect, it, vi } from "vitest";
import { fixtures, installElectronAPIMock } from "../../../../../../../tests/test-utils";
import { desktopWorkspacePanels } from "../../../adapters/electron/workspace-panels";

describe("workspace panel desktop boundary", () => {
  let api: ReturnType<typeof installElectronAPIMock>;
  beforeEach(() => {
    api = installElectronAPIMock();
    api.channels.getFollowed = vi.fn<typeof api.channels.getFollowed>(async () => ({
      success: true,
      data: [fixtures.channel({ id: "100", platform: "twitch", isLive: false })],
    }));
  });
  it("uses the stream snapshot instead of the followed-channel placeholder offline flag", async () => {
    api.streams.getFollowed = vi.fn<typeof api.streams.getFollowed>(async () => ({
      success: true,
      data: [fixtures.stream({ platform: "twitch", channelId: "100", isLive: true })],
      providers: { twitch: "complete" },
    }));
    expect((await desktopWorkspacePanels.followedChannels())[0].isLive).toBe(true);
  });
  it("does not invent offline status when the live snapshot is partial or unavailable", async () => {
    api.streams.getFollowed = vi.fn<typeof api.streams.getFollowed>(async () => ({
      success: true,
      data: [],
      providers: { twitch: "partial" },
    }));
    expect((await desktopWorkspacePanels.followedChannels())[0].isLive).toBeUndefined();
    api.streams.getFollowed = vi.fn<typeof api.streams.getFollowed>(async () => ({
      success: false,
      error: "Unavailable",
      providers: { twitch: "failed" },
    }));
    expect((await desktopWorkspacePanels.followedChannels())[0].isLive).toBeUndefined();
  });
  it("marks offline only with complete live coverage and discards malformed feed payloads", async () => {
    api.streams.getFollowed = vi.fn<typeof api.streams.getFollowed>(async () => ({
      success: true,
      data: [],
      providers: { twitch: "complete" },
    }));
    expect((await desktopWorkspacePanels.followedChannels())[0].isLive).toBe(false);
    let callback: Parameters<typeof api.twitch.eventSub.onEvent>[0] = () => {};
    api.twitch.eventSub.onEvent = (listener) => {
      callback = listener;
      return () => {};
    };
    const received = vi.fn();
    desktopWorkspacePanels.onEvent(received);
    callback({ feedId: "1", payload: { kind: "whisper", message: "unscoped" } });
    expect(received).not.toHaveBeenCalled();
  });
});
