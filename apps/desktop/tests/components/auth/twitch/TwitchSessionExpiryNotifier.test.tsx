import { beforeEach, describe, expect, it, vi } from "vitest";

import { TwitchSessionExpiryNotifier } from "@/features/auth/components/auth/twitch/TwitchSessionExpiryNotifier";
import { renderWithProviders } from "../../../test-utils";

type SonnerModule = typeof import("sonner");
type ToastError = SonnerModule["toast"]["error"];
type AuthStoreModule = typeof import("@/store/auth-store");
type AuthState = ReturnType<AuthStoreModule["useAuthStore"]["getState"]>;
type NotifierAuthState = Pick<AuthState, "initialized" | "twitchReconnectRequired" | "loginTwitch">;

const toastError = vi.hoisted(() => vi.fn<ToastError>());
const mockAuth = vi.hoisted(() => {
  const loginTwitch = vi.fn<NotifierAuthState["loginTwitch"]>();
  const state: NotifierAuthState = {
    initialized: true,
    twitchReconnectRequired: false,
    loginTwitch,
  };
  return { loginTwitch, state };
});

vi.mock("sonner", () => ({
  toast: { error: toastError },
}));

vi.mock("@/store/auth-store", () => ({
  useAuthStore: <T,>(selector: (state: NotifierAuthState) => T): T => selector(mockAuth.state),
}));

function renderNotifier() {
  return renderWithProviders(<TwitchSessionExpiryNotifier />);
}

// Guards: runtime Twitch auth loss tells the user why they were signed out and offers reconnect
// Guards: startup with a remembered Twitch account and no valid token shows the same notice
// Guards: intentional Twitch logout stays quiet
describe("TwitchSessionExpiryNotifier", () => {
  beforeEach(() => {
    mockAuth.loginTwitch.mockReset();
    mockAuth.loginTwitch.mockResolvedValue(undefined);
    toastError.mockReset();
    mockAuth.state.initialized = true;
    mockAuth.state.twitchReconnectRequired = false;
  });

  it("shows the notice when a running session requires reconnect", () => {
    const view = renderNotifier();

    mockAuth.state.twitchReconnectRequired = true;
    view.rerender(<TwitchSessionExpiryNotifier />);

    expect(toastError).toHaveBeenCalledWith("Signed out of Twitch", {
      id: "twitch-session-expired",
      description: "Your Twitch session expired. Reconnect to use chat and account features.",
      duration: 10_000,
      action: { label: "Reconnect", onClick: mockAuth.loginTwitch },
    });
  });

  it("shows the notice from reconnect-required startup state", () => {
    mockAuth.state.twitchReconnectRequired = true;

    renderNotifier();

    expect(toastError).toHaveBeenCalledOnce();
  });

  it("does not notify when the user intentionally logs out", () => {
    const view = renderNotifier();

    mockAuth.state.twitchReconnectRequired = false;
    view.rerender(<TwitchSessionExpiryNotifier />);
    expect(toastError).not.toHaveBeenCalled();
  });
});
