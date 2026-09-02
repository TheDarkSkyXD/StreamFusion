import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TwitchUser } from "@shared/auth-types";
import { AccountConnect } from "@/features/auth/components/auth/AccountConnect";
import { useAuthStore } from "@/store/auth-store";

import { renderWithProviders, screen, userEvent } from "../../test-utils";

const initialAuthState = useAuthStore.getState();
const twitchUser: TwitchUser = {
  id: "u1",
  login: "u",
  displayName: "Twitch user",
  profileImageUrl: "https://example.com/twitch.png",
  createdAt: "2026-01-01T00:00:00Z",
  broadcasterType: "",
};

beforeEach(() => {
  useAuthStore.setState({
    ...initialAuthState,
    twitchUser,
    twitchConnected: true,
    twitchLoading: true,
    kickUser: null,
    kickConnected: false,
    kickLoading: false,
  });
});

// Guards: a connected account must visibly say it is disconnecting while logout cleanup is pending.
// Guards: device login must describe its current phase instead of looking frozen on a generic Connecting label.
// Guards: a connected Kick account exposes only disconnect and does not suggest unnecessary chat repair.
// Guards: a linked Twitch identity stays visible, and reconnect appears only when authorization is degraded.
describe("AccountConnect", () => {
  it("renders an honest pending label and disables repeated Twitch disconnects", () => {
    renderWithProviders(<AccountConnect />);

    expect(screen.getByRole("button", { name: "Disconnecting..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Disconnect" })).not.toBeInTheDocument();
  });

  it("shows when Twitch is waiting for authorization", () => {
    useAuthStore.setState({
      twitchUser: null,
      twitchConnected: false,
      twitchLoading: true,
      twitchAuthPhase: "waiting",
    });

    renderWithProviders(<AccountConnect />);

    expect(
      screen.getByRole("button", { name: "Waiting for Twitch authorization..." })
    ).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Connecting..." })).not.toBeInTheDocument();
  });

  it("does not offer a redundant Kick chat repair action", () => {
    useAuthStore.setState({
      twitchLoading: false,
      kickUser: { id: 42, username: "viewer", slug: "viewer" } as never,
      kickConnected: true,
      kickLoading: false,
    });

    renderWithProviders(<AccountConnect />);

    expect(screen.queryByRole("button", { name: "Repair Kick chat" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(2);
  });

  it("shows a remembered Twitch identity with a reconnect action", async () => {
    const loginTwitch = vi.fn(async () => undefined);
    useAuthStore.setState({
      twitchUser,
      twitchConnected: false,
      twitchReconnectRequired: true,
      twitchLoading: false,
      loginTwitch,
    });

    renderWithProviders(<AccountConnect />);

    expect(screen.getByText("Twitch user")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connect Twitch" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect Twitch" }));
    expect(loginTwitch).toHaveBeenCalledTimes(1);
  });

  it("does not infer reconnect from a temporary disconnected state", () => {
    useAuthStore.setState({
      twitchUser,
      twitchConnected: false,
      twitchReconnectRequired: false,
      twitchLoading: true,
    });

    renderWithProviders(<AccountConnect />);

    expect(screen.getByText("Twitch user")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect Twitch" })).not.toBeInTheDocument();
  });
});
