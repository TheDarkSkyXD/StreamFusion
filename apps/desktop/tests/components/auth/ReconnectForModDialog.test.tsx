import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReconnectForModDialog } from "@/components/auth/ReconnectForModDialog";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

// Every Twitch scope U5 covers — the two pin-path scopes (U7) plus the
// nine channel-management console scopes (U4).
const ALL_ELEVEN_SCOPES = [
  "user:read:moderated_channels",
  "moderator:manage:chat_messages",
  "moderator:manage:banned_users",
  "moderator:manage:shield_mode",
  "channel:manage:raids",
  "channel:manage:moderators",
  "channel:manage:vips",
  "channel:manage:predictions",
  "channel:manage:polls",
  "channel:edit:commercial",
  "user:manage:whispers",
];

const EXPECTED_DESCRIPTIONS: Record<string, string> = {
  "user:read:moderated_channels": "See which channels you moderate",
  "moderator:manage:chat_messages": "Pin, unpin, and delete chat messages",
  "moderator:manage:banned_users": "Time out, ban, and unban users",
  "moderator:manage:shield_mode": "Toggle Shield Mode",
  "channel:manage:raids": "Start and cancel raids",
  "channel:manage:moderators": "Add and remove moderators",
  "channel:manage:vips": "Add and remove VIPs",
  "channel:manage:predictions": "Create, lock, and resolve predictions",
  "channel:manage:polls": "Create and terminate polls",
  "channel:edit:commercial": "Start commercial breaks",
  "user:manage:whispers": "Send whispers",
};

const logoutTwitch = vi.fn(async () => undefined);
const loginTwitch = vi.fn(async () => undefined);

beforeEach(() => {
  logoutTwitch.mockClear();
  loginTwitch.mockClear();
  useReconnectDialogStore.setState({
    isOpen: false,
    missingScopes: [],
    onReconnected: null,
  });
  // Stub the auth-store actions the dialog consumes. We only patch the bits
  // the dialog reads — twitchLoading stays false, login/logout resolve.
  useAuthStore.setState({
    twitchLoading: false,
    logoutTwitch,
    loginTwitch,
  } as Partial<ReturnType<typeof useAuthStore.getState>> as ReturnType<
    typeof useAuthStore.getState
  >);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReconnectForModDialog", () => {
  it("renders nothing when isOpen=false", () => {
    render(<ReconnectForModDialog />);
    expect(screen.queryByText(/reconnect for mod features/i)).not.toBeInTheDocument();
  });

  it("renders every U4 scope plus the two pin scopes when opened with all 11", () => {
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({ missingScopes: ALL_ELEVEN_SCOPES });
    });

    for (const scope of ALL_ELEVEN_SCOPES) {
      const desc = EXPECTED_DESCRIPTIONS[scope];
      expect(screen.getByText(desc)).toBeInTheDocument();
    }
  });

  it("renders an unknown scope id as raw text fallback", () => {
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore
        .getState()
        .open({ missingScopes: ["unknown:scope:thing"] });
    });

    expect(screen.getByText("unknown:scope:thing")).toBeInTheDocument();
  });

  it("AE12: renders both descriptions when given two specific scopes", () => {
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        missingScopes: ["moderator:manage:banned_users", "channel:manage:raids"],
      });
    });

    expect(screen.getByText("Time out, ban, and unban users")).toBeInTheDocument();
    expect(screen.getByText("Start and cancel raids")).toBeInTheDocument();
  });

  it("clicking Reconnect calls logoutTwitch → loginTwitch → fireReconnected + close exactly once", async () => {
    const onReconnected = vi.fn();
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        missingScopes: ["moderator:manage:chat_messages"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^reconnect$/i }));

    await waitFor(() => expect(logoutTwitch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(loginTwitch).toHaveBeenCalledTimes(1));
    // fireReconnected fires the registered onReconnected exactly once.
    await waitFor(() => expect(onReconnected).toHaveBeenCalledTimes(1));
    // close() is observable via isOpen flipping back to false.
    await waitFor(() => expect(useReconnectDialogStore.getState().isOpen).toBe(false));
    // After fireReconnected, the callback is nulled so a second invocation
    // can never re-fire it.
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();

    // Order: logout → login.
    expect(logoutTwitch.mock.invocationCallOrder[0]).toBeLessThan(
      loginTwitch.mock.invocationCallOrder[0]
    );
  });

  it("onReconnected callback fires exactly once via fireReconnected and never twice", () => {
    const onReconnected = vi.fn();
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        missingScopes: ["channel:manage:raids"],
        onReconnected,
      });
    });

    act(() => {
      useReconnectDialogStore.getState().fireReconnected();
    });
    expect(onReconnected).toHaveBeenCalledTimes(1);

    // A second fireReconnected (e.g. dialog reopened and confirmed again
    // without re-registering) must NOT re-invoke the stale callback.
    act(() => {
      useReconnectDialogStore.getState().fireReconnected();
    });
    expect(onReconnected).toHaveBeenCalledTimes(1);
  });

  it("clicking Not now closes without invoking logout/login or the retry callback", () => {
    const onReconnected = vi.fn();
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        missingScopes: ["channel:manage:raids"],
        onReconnected,
      });
    });

    expect(useReconnectDialogStore.getState().isOpen).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));

    // close() flips isOpen to false. logout/login/onReconnected stay untouched.
    expect(useReconnectDialogStore.getState().isOpen).toBe(false);
    expect(logoutTwitch).not.toHaveBeenCalled();
    expect(loginTwitch).not.toHaveBeenCalled();
    expect(onReconnected).not.toHaveBeenCalled();
    // The registered callback survives a plain close — it only clears on a
    // successful reconnect via fireReconnected().
    expect(useReconnectDialogStore.getState().onReconnected).toBe(onReconnected);
  });
});
