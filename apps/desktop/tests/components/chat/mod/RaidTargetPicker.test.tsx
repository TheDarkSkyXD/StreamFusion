import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RaidTargetPicker,
  type RaidTarget,
  recentRaidsKey,
} from "@/components/chat/mod/RaidTargetPicker";
import { useFollowStore } from "@/store/follow-store";

const storeApi = {
  get: vi.fn<(key: string) => Promise<unknown>>(),
  set: vi.fn<(key: string, value: unknown) => Promise<void>>(),
  delete: vi.fn<(key: string) => Promise<void>>(),
};

beforeEach(() => {
  storeApi.get.mockReset();
  storeApi.set.mockReset();
  storeApi.delete.mockReset();
  // @ts-expect-error — test-only stub of window.electronAPI
  globalThis.window.electronAPI = { store: storeApi };
  useFollowStore.setState({ localFollows: [] });
});

afterEach(() => {
  // @ts-expect-error — clean up
  delete globalThis.window.electronAPI;
});

describe("RaidTargetPicker", () => {
  it("filters the user's Twitch follows by typed query", () => {
    useFollowStore.setState({
      localFollows: [
        {
          id: "100",
          platform: "twitch",
          username: "alpha",
          displayName: "AlphaStreamer",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        } as any,
        {
          id: "200",
          platform: "twitch",
          username: "beta",
          displayName: "BetaStreamer",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        } as any,
        // Kick follow should be filtered out — we only raid Twitch channels.
        {
          id: "300",
          platform: "kick",
          username: "alphakick",
          displayName: "AlphaKick",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        } as any,
      ],
    });
    storeApi.get.mockResolvedValue(null);
    render(
      <RaidTargetPicker
        selfBroadcasterId="me"
        disabled={false}
        onChange={() => {}}
      />,
    );
    // Initial render shows all Twitch follows.
    expect(screen.getByText("AlphaStreamer")).toBeInTheDocument();
    expect(screen.getByText("BetaStreamer")).toBeInTheDocument();
    expect(screen.queryByText("AlphaKick")).toBeNull();

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "beta" } });
    expect(screen.queryByText("AlphaStreamer")).toBeNull();
    expect(screen.getByText("BetaStreamer")).toBeInTheDocument();
  });

  it("renders the Recent section when the key/value store returns entries", async () => {
    const recent: RaidTarget[] = [
      { broadcasterId: "5", broadcasterLogin: "five", broadcasterName: "FiveStreamer" },
    ];
    storeApi.get.mockResolvedValue(recent);
    render(
      <RaidTargetPicker
        selfBroadcasterId="me"
        disabled={false}
        onChange={() => {}}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId("raid-target-picker-recent")).toBeInTheDocument(),
    );
    expect(screen.getByText(/^Recent$/)).toBeInTheDocument();
    expect(screen.getByText("FiveStreamer")).toBeInTheDocument();
    expect(storeApi.get).toHaveBeenCalledWith(recentRaidsKey("me"));
  });

  it("selecting a filter result fires onChange with the target", () => {
    useFollowStore.setState({
      localFollows: [
        {
          id: "100",
          platform: "twitch",
          username: "alpha",
          displayName: "AlphaStreamer",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        } as any,
      ],
    });
    storeApi.get.mockResolvedValue(null);
    const onChange = vi.fn();
    render(
      <RaidTargetPicker
        selfBroadcasterId="me"
        disabled={false}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText("AlphaStreamer"));
    expect(onChange).toHaveBeenCalledWith({
      broadcasterId: "100",
      broadcasterLogin: "alpha",
      broadcasterName: "AlphaStreamer",
    });
  });

  it("selecting a recent entry fires onChange with the recent target", async () => {
    const recent: RaidTarget[] = [
      { broadcasterId: "5", broadcasterLogin: "five", broadcasterName: "FiveStreamer" },
    ];
    storeApi.get.mockResolvedValue(recent);
    const onChange = vi.fn();
    render(
      <RaidTargetPicker selfBroadcasterId="me" disabled={false} onChange={onChange} />,
    );
    await waitFor(() => screen.getByText("FiveStreamer"));
    fireEvent.click(screen.getByText("FiveStreamer"));
    expect(onChange).toHaveBeenCalledWith(recent[0]);
  });

  it("shows 'No matches' when typed query matches no follows", () => {
    useFollowStore.setState({
      localFollows: [
        {
          id: "100",
          platform: "twitch",
          username: "alpha",
          displayName: "AlphaStreamer",
          avatarUrl: "",
          isLive: false,
          isVerified: false,
          isPartner: false,
        } as any,
      ],
    });
    storeApi.get.mockResolvedValue(null);
    render(
      <RaidTargetPicker selfBroadcasterId="me" disabled={false} onChange={() => {}} />,
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "nothing" } });
    expect(screen.getByTestId("raid-target-picker-empty")).toBeInTheDocument();
  });
});
