import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReconnectForModDialog } from "@/features/auth/components/auth/ReconnectForModDialog";
import { KICK_APP_SCOPES, TWITCH_APP_SCOPES } from "@shared/auth-types";
import { useAuthStore } from "@/store/auth-store";
import { useReconnectDialogStore } from "@/store/reconnect-dialog-store";

const TWITCH_MOD_SCOPES = [
  "user:read:moderated_channels",
  "moderator:manage:chat_messages",
  "moderator:manage:banned_users",
  "moderator:manage:warnings",
  "moderator:manage:shield_mode",
  "channel:manage:raids",
  "channel:manage:moderators",
  "channel:manage:vips",
  "channel:manage:predictions",
  "channel:manage:polls",
  "channel:edit:commercial",
  "user:manage:whispers",
  "moderator:read:unban_requests",
  "moderator:manage:unban_requests",
];

const EXPECTED_DESCRIPTIONS: Record<string, string> = {
  "user:read:moderated_channels": "See which channels you moderate",
  "moderator:manage:chat_messages": "Pin, unpin, and delete chat messages",
  "moderator:manage:banned_users": "Time out, ban, and unban users",
  "moderator:manage:warnings": "Warn users in chat",
  "moderator:manage:shield_mode": "Toggle Shield Mode",
  "channel:manage:raids": "Start and cancel raids",
  "channel:manage:moderators": "Add and remove moderators",
  "channel:manage:vips": "Add and remove VIPs",
  "channel:manage:predictions": "Create, lock, and resolve predictions",
  "channel:manage:polls": "Create and terminate polls",
  "channel:edit:commercial": "Start commercial breaks",
  "user:manage:whispers": "Send whispers",
  "moderator:read:unban_requests": "Review unban requests",
  "moderator:manage:unban_requests": "Approve or deny unban requests",
};

const loginTwitch = vi.fn(async () => undefined);
const loginKick = vi.fn(async () => undefined);
const tokenStatus = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

beforeEach(() => {
  loginTwitch.mockReset();
  loginTwitch.mockResolvedValue(undefined);
  loginKick.mockReset();
  loginKick.mockResolvedValue(undefined);
  tokenStatus.mockReset();
  tokenStatus.mockImplementation(async (platform: "twitch" | "kick") => ({
    platform,
    connected: true,
    valid: true,
    scopes: platform === "twitch" ? [...TWITCH_APP_SCOPES] : [...KICK_APP_SCOPES],
  }));
  useReconnectDialogStore.setState({
    isOpen: false,
    platform: "twitch",
    phase: "idle",
    missingScopes: [],
    onReconnected: null,
  });
  useAuthStore.setState({
    twitchLoading: false,
    kickLoading: false,
    loginTwitch,
    loginKick,
  } as Partial<ReturnType<typeof useAuthStore.getState>> as ReturnType<
    typeof useAuthStore.getState
  >);
  Object.assign(window, {
    electronAPI: {
      auth: { tokenStatus },
    },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReconnectForModDialog", () => {
  it("renders nothing when closed", () => {
    render(<ReconnectForModDialog />);
    expect(screen.queryByText(/reconnect twitch/i)).not.toBeInTheDocument();
  });

  it("renders every requested Twitch moderation scope description", () => {
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: TWITCH_MOD_SCOPES,
      });
    });

    for (const scope of TWITCH_MOD_SCOPES) {
      expect(screen.getByText(EXPECTED_DESCRIPTIONS[scope])).toBeInTheDocument();
    }
  });

  it("renders an unknown scope id instead of hiding it", () => {
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: ["unknown:scope:thing"],
      });
    });

    expect(screen.getByText("unknown:scope:thing")).toBeInTheDocument();
  });

  it("reconnects Twitch, validates official token status, refreshes, and closes", async () => {
    const onReconnected = vi.fn(async () => undefined);
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: ["moderator:manage:chat_messages"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^reconnect twitch$/i }));

    await waitFor(() => expect(loginTwitch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(tokenStatus).toHaveBeenCalledWith("twitch"));
    await waitFor(() => expect(onReconnected).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useReconnectDialogStore.getState().isOpen).toBe(false));
    expect(useReconnectDialogStore.getState().onReconnected).toBeNull();
  });

  it("uses the Kick flow and Kick scope descriptions for Kick authority", async () => {
    const onReconnected = vi.fn(async () => undefined);
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "kick",
        missingScopes: ["moderation:ban"],
        onReconnected,
      });
    });

    expect(screen.getByRole("heading", { name: "Reconnect Kick" })).toBeInTheDocument();
    expect(screen.getByText("Time out, ban, and unban Kick users")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^reconnect kick$/i }));

    await waitFor(() => expect(loginKick).toHaveBeenCalledTimes(1));
    expect(loginTwitch).not.toHaveBeenCalled();
    await waitFor(() => expect(tokenStatus).toHaveBeenCalledWith("kick"));
    await waitFor(() => expect(onReconnected).toHaveBeenCalledTimes(1));
  });

  it("fails closed when official token status is missing any canonical scope", async () => {
    const onReconnected = vi.fn();
    tokenStatus.mockResolvedValue({
      platform: "twitch",
      connected: true,
      valid: true,
      scopes: TWITCH_APP_SCOPES.filter((scope) => scope !== "channel:manage:polls"),
    });
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: ["moderator:manage:chat_messages"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^reconnect twitch$/i }));

    await screen.findByText("Reconnect failed · Retry");
    expect(onReconnected).not.toHaveBeenCalled();
    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: true,
      phase: "failed",
      onReconnected,
    });
  });

  it("locks dismissal and duplicate submission while authorization is pending", async () => {
    const pendingLogin = deferred<undefined>();
    loginTwitch.mockReturnValueOnce(pendingLogin.promise);
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: ["moderator:manage:chat_messages"],
      });
    });

    const reconnect = screen.getByRole("button", { name: /^reconnect twitch$/i });
    fireEvent.click(reconnect);
    fireEvent.click(reconnect);

    await screen.findByText("Waiting for Twitch authorization…");
    expect(loginTwitch).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: /reconnecting/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /not now/i })).toBeDisabled();
    act(() => useReconnectDialogStore.getState().close());
    expect(useReconnectDialogStore.getState().isOpen).toBe(true);

    pendingLogin.resolve(undefined);
    await waitFor(() => expect(useReconnectDialogStore.getState().isOpen).toBe(false));
  });

  it("keeps the dialog locked through token revalidation and callback refresh", async () => {
    const pendingStatus = deferred<{
      platform: "twitch";
      connected: true;
      valid: true;
      scopes: string[];
    }>();
    const pendingRefresh = deferred<void>();
    tokenStatus.mockReturnValueOnce(pendingStatus.promise);
    const onReconnected = vi.fn(() => pendingRefresh.promise);
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: ["moderator:manage:chat_messages"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^reconnect twitch$/i }));
    await screen.findByText("Revalidating permissions and moderation access…");
    expect(useReconnectDialogStore.getState().phase).toBe("revalidating");
    act(() => useReconnectDialogStore.getState().close());
    expect(useReconnectDialogStore.getState().isOpen).toBe(true);

    pendingStatus.resolve({
      platform: "twitch",
      connected: true,
      valid: true,
      scopes: [...TWITCH_APP_SCOPES],
    });
    await waitFor(() => expect(onReconnected).toHaveBeenCalledTimes(1));
    expect(useReconnectDialogStore.getState().isOpen).toBe(true);

    pendingRefresh.resolve();
    await waitFor(() => expect(useReconnectDialogStore.getState().isOpen).toBe(false));
  });

  it("keeps the callback for Retry when authorization fails", async () => {
    const onReconnected = vi.fn();
    loginTwitch.mockRejectedValueOnce(new Error("OAuth window closed"));
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "twitch",
        missingScopes: ["channel:manage:raids"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^reconnect twitch$/i }));

    await screen.findByText("Reconnect failed · Retry");
    expect(onReconnected).not.toHaveBeenCalled();
    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: true,
      phase: "failed",
      onReconnected,
    });
  });

  it.each([
    "twitch",
    "kick",
  ] as const)("cancels the %s reconnect flow and clears its callback when the user chooses Not now", (platform) => {
    const onReconnected = vi.fn();
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform,
        missingScopes: ["channel:manage:raids"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /not now/i }));

    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: false,
      phase: "idle",
      onReconnected: null,
    });
    expect(loginTwitch).not.toHaveBeenCalled();
    expect(loginKick).not.toHaveBeenCalled();
    expect(onReconnected).not.toHaveBeenCalled();
  });

  it("lets a failed Kick reconnect retry and complete the preserved refresh callback", async () => {
    const onReconnected = vi.fn(async () => undefined);
    loginKick.mockRejectedValueOnce(new Error("OAuth window closed"));
    render(<ReconnectForModDialog />);
    act(() => {
      useReconnectDialogStore.getState().open({
        platform: "kick",
        missingScopes: ["moderation:ban"],
        onReconnected,
      });
    });

    fireEvent.click(screen.getByRole("button", { name: /^reconnect kick$/i }));
    await screen.findByText(/Reconnect failed.*Retry/);
    expect(useReconnectDialogStore.getState()).toMatchObject({
      isOpen: true,
      phase: "failed",
      onReconnected,
    });

    fireEvent.click(screen.getByRole("button", { name: /^retry$/i }));
    await waitFor(() => expect(loginKick).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(onReconnected).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(useReconnectDialogStore.getState().isOpen).toBe(false));
  });
});
