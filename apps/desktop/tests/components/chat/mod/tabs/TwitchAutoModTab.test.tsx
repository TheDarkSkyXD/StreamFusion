import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AutomodMessageHoldEvent,
  NotificationPayload,
} from "@/backend/api/platforms/twitch/twitch-eventsub-types";
import { useAuthStore } from "@/store/auth-store";
import { useAutoModQueueStore } from "@/store/automod-queue-store";

// U23 — mock sonner so we can assert toast() was called with Approve/Deny
// actions and confirm the OS-notif path defers to the throttle service.
const toastSpy = vi.fn();
vi.mock("sonner", () => ({
  toast: Object.assign((...args: unknown[]) => toastSpy(...args), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

const enqueueSpy = vi.fn();
vi.mock("@/backend/services/os-notification-throttle", () => ({
  osNotificationThrottle: {
    enqueue: (input: unknown) => enqueueSpy(input),
    __flushForTesting: vi.fn(),
    __resetForTesting: vi.fn(),
  },
}));

const dbGetSpy = vi.fn();
vi.mock("@/backend/services/database-service", () => ({
  dbService: {
    get: (key: string) => dbGetSpy(key),
    set: vi.fn(),
  },
}));

// Capture the listener so tests can synthesize EventSub notifications.
let lastListener:
  | ((p: NotificationPayload<AutomodMessageHoldEvent>) => void)
  | null = null;

vi.mock("@/hooks/useTwitchEventSub", () => ({
  useTwitchEventSub: (
    _type: unknown,
    _channelId: string | null,
    listener: (p: NotificationPayload<AutomodMessageHoldEvent>) => void,
  ) => {
    lastListener = listener;
    return { connectionState: "connected" };
  },
}));

import { TwitchAutoModTab } from "@/components/chat/mod/tabs/TwitchAutoModTab";

const CHANNEL_ID = "111";
const MODERATOR_ID = "999";

function makeNotification(
  overrides: Partial<AutomodMessageHoldEvent> = {},
): NotificationPayload<AutomodMessageHoldEvent> {
  const event: AutomodMessageHoldEvent = {
    broadcaster_user_id: CHANNEL_ID,
    broadcaster_user_login: "channel",
    broadcaster_user_name: "Channel",
    user_id: "42",
    user_login: "baduser",
    user_name: "BadUser",
    message_id: "msg-1",
    message: { text: "you suck", fragments: [{ type: "text", text: "you suck" }] },
    category: "harassment",
    level: 3,
    held_at: new Date(1_700_000_000_000).toISOString(),
    ...overrides,
  };
  return {
    subscription: {
      id: "sub",
      type: "automod.message.hold",
      version: "1",
      status: "enabled",
      cost: 0,
      condition: {},
      transport: { method: "websocket", session_id: "s" },
      created_at: "",
    },
    event,
  };
}

const fetchMock = vi.fn();
const getTokenMock = vi.fn();

beforeEach(() => {
  lastListener = null;
  toastSpy.mockReset();
  enqueueSpy.mockReset();
  dbGetSpy.mockReset();
  dbGetSpy.mockReturnValue(false); // OS-notif OFF by default per plan decision
  useAutoModQueueStore.setState({ byKey: new Map() });
  useAuthStore.setState({
    twitchUser: {
      id: MODERATOR_ID,
      login: "mod",
      displayName: "Mod",
      profileImageUrl: "",
      email: null,
    } as any,
  });
  fetchMock.mockReset();
  getTokenMock.mockReset();
  getTokenMock.mockResolvedValue({ accessToken: "tok" });
  (globalThis.window as unknown as { electronAPI: unknown }).electronAPI = {
    auth: { getToken: getTokenMock },
  };
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  delete (globalThis.window as unknown as { electronAPI?: unknown })
    .electronAPI;
  vi.unstubAllGlobals();
});

describe("TwitchAutoModTab", () => {
  it("adds an incoming automod.message.hold notification to the queue store", () => {
    render(<TwitchAutoModTab channelId={CHANNEL_ID} />);
    expect(lastListener).toBeTruthy();
    act(() => {
      lastListener?.(makeNotification());
    });
    expect(
      useAutoModQueueStore.getState().countForChannel(CHANNEL_ID),
    ).toBe(1);
  });

  it("renders the queued message with username, category, and level", () => {
    render(<TwitchAutoModTab channelId={CHANNEL_ID} />);
    act(() => {
      lastListener?.(makeNotification());
    });
    expect(screen.getByText("baduser")).toBeInTheDocument();
    expect(screen.getByTestId("automod-category").textContent).toContain(
      "harassment",
    );
    expect(screen.getByTestId("automod-category").textContent).toContain("L3");
    expect(screen.getByText("you suck")).toBeInTheDocument();
  });

  it("Approve calls Helix with action=ALLOW and removes the entry on 200", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    render(<TwitchAutoModTab channelId={CHANNEL_ID} />);
    act(() => {
      lastListener?.(makeNotification());
    });
    fireEvent.click(screen.getByTestId("automod-approve"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.twitch.tv/helix/moderation/automod/message",
    );
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      user_id: MODERATOR_ID,
      msg_id: "msg-1",
      action: "ALLOW",
    });
    await waitFor(() => {
      expect(
        useAutoModQueueStore.getState().countForChannel(CHANNEL_ID),
      ).toBe(0);
    });
  });

  it("Deny calls Helix with action=DENY", async () => {
    fetchMock.mockResolvedValueOnce(new Response("{}", { status: 200 }));
    render(<TwitchAutoModTab channelId={CHANNEL_ID} />);
    act(() => {
      lastListener?.(makeNotification());
    });
    fireEvent.click(screen.getByTestId("automod-deny"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.action).toBe("DENY");
  });

  it("Allow + Allow-list fires two calls (Approve + add-permitted)", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(new Response("{}", { status: 200 }));
    render(<TwitchAutoModTab channelId={CHANNEL_ID} />);
    act(() => {
      lastListener?.(makeNotification());
    });
    fireEvent.click(screen.getByTestId("automod-allow-allowlist"));
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    const [firstUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    const [secondUrl, secondInit] = fetchMock.mock.calls[1] as [
      string,
      RequestInit,
    ];
    expect(firstUrl).toContain("/automod/message");
    expect(secondUrl).toContain("/automod/permitted");
    const body = JSON.parse(secondInit.body as string);
    expect(body).toMatchObject({
      broadcaster_id: CHANNEL_ID,
      moderator_id: MODERATOR_ID,
      user_id: "42",
    });
  });

  it("renders an empty state when no held messages exist", () => {
    render(<TwitchAutoModTab channelId={CHANNEL_ID} />);
    expect(screen.getByText(/No held messages/i)).toBeInTheDocument();
  });

  // U23 — alert pipeline tests.
  it("fires a sonner toast (with Approve/Deny actions) when a new hold arrives", async () => {
    render(<TwitchAutoModTab channelId={CHANNEL_ID} channelName="streamer" />);
    act(() => {
      lastListener?.(makeNotification());
    });
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });
    const [title, opts] = toastSpy.mock.calls.at(-1) as [
      string,
      { action?: { label: string }; cancel?: { label: string } },
    ];
    expect(title).toContain("baduser");
    expect(opts.action?.label).toBe("Approve");
    expect(opts.cancel?.label).toBe("Deny");
  });

  it("calls osNotificationThrottle.enqueue when the per-channel pref is enabled", async () => {
    dbGetSpy.mockImplementation((key: string) =>
      key === `automod-os-notif:${CHANNEL_ID}` ? true : null,
    );
    render(<TwitchAutoModTab channelId={CHANNEL_ID} channelName="streamer" />);
    act(() => {
      lastListener?.(makeNotification());
    });
    await waitFor(() => {
      expect(enqueueSpy).toHaveBeenCalled();
    });
    const [input] = enqueueSpy.mock.calls.at(-1) as [
      { channelId: string; channelName: string; preview: string },
    ];
    expect(input.channelId).toBe(CHANNEL_ID);
    expect(input.channelName).toBe("streamer");
    expect(input.preview).toContain("baduser");
  });

  it("does NOT call osNotificationThrottle.enqueue when the pref is OFF", async () => {
    dbGetSpy.mockReturnValue(false);
    render(<TwitchAutoModTab channelId={CHANNEL_ID} channelName="streamer" />);
    act(() => {
      lastListener?.(makeNotification());
    });
    // Wait one microtask so the subscriber has a chance to run.
    await waitFor(() => {
      expect(toastSpy).toHaveBeenCalled();
    });
    expect(enqueueSpy).not.toHaveBeenCalled();
  });
});
