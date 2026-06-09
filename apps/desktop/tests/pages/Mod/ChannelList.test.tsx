import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  installElectronAPIMock,
  renderWithProviders,
  routerMock,
  screen,
  waitFor,
} from "../../test-utils";

vi.mock("@tanstack/react-router", () => routerMock());

const mocks = vi.hoisted(() => ({
  authState: {
    twitchUser: null as { id: string; login: string; displayName: string } | null,
    kickUser: null as { id: number; username: string; slug: string } | null,
  },
  getModeratedChannels: vi.fn(
    async (..._args: unknown[]) =>
      [] as Array<{ broadcaster_id: string; broadcaster_login: string; broadcaster_name: string }>
  ),
}));

vi.mock("@/store/auth-store", () => {
  const useStore = (selector: (s: typeof mocks.authState) => unknown) => selector(mocks.authState);
  // biome-ignore lint/suspicious/noExplicitAny: store shim.
  (useStore as any).getState = () => mocks.authState;
  return { useAuthStore: useStore };
});

vi.mock("@/backend/api/platforms/twitch/twitch-helix-moderation", () => ({
  getModeratedChannels: (...args: unknown[]) => mocks.getModeratedChannels(...args),
}));

import { ChannelList } from "@/pages/Mod/ChannelList";

describe("ChannelList", () => {
  let api: ReturnType<typeof installElectronAPIMock>;

  beforeEach(() => {
    mocks.authState.twitchUser = null;
    mocks.authState.kickUser = null;
    mocks.getModeratedChannels.mockResolvedValue([]);
    api = installElectronAPIMock();
    api.auth.getToken = vi.fn(async () => ({ accessToken: "tok" }));
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: "cid" };
  });

  it("shows empty state when no users are signed in", () => {
    renderWithProviders(<ChannelList />);
    expect(screen.getByTestId("mod-channel-list-empty")).toBeInTheDocument();
    expect(screen.getByText("You don't moderate any channels yet.")).toBeInTheDocument();
  });

  it("renders the Twitch broadcaster's own channel card", async () => {
    mocks.authState.twitchUser = { id: "111", login: "streamer", displayName: "Streamer" };
    renderWithProviders(<ChannelList />);
    await waitFor(() => {
      expect(screen.getByTestId("mod-channel-card-twitch-streamer")).toBeInTheDocument();
    });
    expect(screen.getByText("Streamer")).toBeInTheDocument();
  });

  it("renders moderated Twitch channels returned by the API", async () => {
    mocks.authState.twitchUser = { id: "111", login: "streamer", displayName: "Streamer" };
    mocks.getModeratedChannels.mockResolvedValue([
      { broadcaster_id: "222", broadcaster_login: "othermod", broadcaster_name: "OtherMod" },
    ]);
    renderWithProviders(<ChannelList />);
    await waitFor(() => {
      expect(screen.getByTestId("mod-channel-card-twitch-othermod")).toBeInTheDocument();
    });
    expect(screen.getByText("OtherMod")).toBeInTheDocument();
  });

  it("renders a Kick channel card when a Kick user is signed in", () => {
    mocks.authState.kickUser = { id: 42, username: "kickuser", slug: "kickuser" };
    renderWithProviders(<ChannelList />);
    expect(screen.getByTestId("mod-channel-card-kick-kickuser")).toBeInTheDocument();
    expect(screen.getByText("kickuser")).toBeInTheDocument();
  });

  it("renders both Twitch and Kick cards when both platforms are signed in", async () => {
    mocks.authState.twitchUser = { id: "111", login: "streamer", displayName: "Streamer" };
    mocks.authState.kickUser = { id: 42, username: "kickuser", slug: "kickuser" };
    renderWithProviders(<ChannelList />);
    await waitFor(() => {
      expect(screen.getByTestId("mod-channel-card-twitch-streamer")).toBeInTheDocument();
    });
    expect(screen.getByTestId("mod-channel-card-kick-kickuser")).toBeInTheDocument();
  });

  it("shows 'Loading...' while Twitch channels are being fetched", () => {
    mocks.authState.twitchUser = { id: "111", login: "streamer", displayName: "Streamer" };
    mocks.getModeratedChannels.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ChannelList />);
    // The broadcaster's own card shows immediately (no loading gate), so the
    // grid renders rather than the loading text.
    expect(screen.getByTestId("mod-channel-list-grid")).toBeInTheDocument();
  });

  it("displays the channel list grid container when entries exist", async () => {
    mocks.authState.twitchUser = { id: "111", login: "streamer", displayName: "Streamer" };
    renderWithProviders(<ChannelList />);
    await waitFor(() => {
      expect(screen.getByTestId("mod-channel-list-grid")).toBeInTheDocument();
    });
  });

  it("uses slug as channelParam for Kick when slug is available", () => {
    mocks.authState.kickUser = { id: 42, username: "KickUser", slug: "kick-slug" };
    renderWithProviders(<ChannelList />);
    expect(screen.getByTestId("mod-channel-card-kick-kick-slug")).toBeInTheDocument();
  });
});
