import { beforeEach, describe, expect, it } from "vitest";

import { AccountConnect } from "@/features/auth/components/auth/AccountConnect";
import { useAuthStore } from "@/store/auth-store";

import { renderWithProviders, screen } from "../../test-utils";

const initialAuthState = useAuthStore.getState();

beforeEach(() => {
  useAuthStore.setState({
    ...initialAuthState,
    twitchUser: { id: "u1", login: "u", displayName: "Twitch user" } as never,
    twitchConnected: true,
    twitchLoading: true,
    kickUser: null,
    kickConnected: false,
    kickLoading: false,
  });
});

// Guards: a connected account must visibly say it is disconnecting while logout cleanup is pending.
// Guards: device login must describe its current phase instead of looking frozen on a generic Connecting label.
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

  it("offers Kick website-session repair without requiring logout", () => {
    useAuthStore.setState({
      twitchLoading: false,
      kickUser: { id: 42, username: "viewer", slug: "viewer" } as never,
      kickConnected: true,
      kickLoading: false,
    });

    renderWithProviders(<AccountConnect />);

    expect(screen.getByRole("button", { name: "Repair Kick chat" })).toBeEnabled();
    expect(screen.getAllByRole("button", { name: "Disconnect" })).toHaveLength(2);
  });
});
