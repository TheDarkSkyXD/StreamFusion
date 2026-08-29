import { beforeEach, describe, expect, it, vi } from "vitest";

const mockNavigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mockNavigate,
}));

import { NotificationsDropdown } from "@/features/shell/components/TopNavBar/NotificationsDropdown";
import { useNotificationStore } from "@/store/notification-store";

import { renderWithProviders, screen, userEvent } from "../../test-utils";

beforeEach(() => {
  vi.restoreAllMocks();
  mockNavigate.mockClear();
  localStorage.clear();
  useNotificationStore.setState({ notifications: [] });
});

// Guards: notification dropdown must render real persisted Live Notifications, never demo mock rows.
describe("NotificationsDropdown", () => {
  it("shows an empty state instead of mock notification rows when history is empty", async () => {
    renderWithProviders(<NotificationsDropdown />);

    await userEvent.click(screen.getByTitle("Notifications"));

    expect(screen.getByText("No new notifications")).toBeInTheDocument();
    expect(screen.queryByText("Ninja")).not.toBeInTheDocument();
    expect(screen.queryByText("xQc")).not.toBeInTheDocument();
    expect(screen.queryByText("Fortnite Customs!")).not.toBeInTheDocument();
  });

  it("renders real Live Notification rows with stream details and relative time", async () => {
    const now = new Date("2026-07-01T12:00:00.000Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);
    useNotificationStore.getState().addNotification({
      id: "live-1",
      platform: "kick",
      channelId: "100",
      channelName: "xqc",
      channelDisplayName: "xQc",
      title: "Variety stream",
      createdAt: now - 15 * 60_000,
    });

    renderWithProviders(<NotificationsDropdown />);
    await userEvent.click(screen.getByTitle("Notifications"));

    expect(screen.getByText("xQc")).toBeInTheDocument();
    expect(screen.getByText("is live")).toBeInTheDocument();
    expect(screen.getByText("Variety stream")).toBeInTheDocument();
    expect(screen.getByText("15 min ago")).toBeInTheDocument();
  });

  it("renders the channel avatar when a Live Notification includes one", async () => {
    useNotificationStore.getState().addNotification({
      id: "live-1",
      platform: "twitch",
      channelId: "100",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      title: "Alpha stream",
      createdAt: Date.now(),
      channelAvatar:
        "https://static-cdn.jtvnw.net/jtv_user_pictures/alpha-profile_image-1234-300x300.jpeg",
    });

    renderWithProviders(<NotificationsDropdown />);
    await userEvent.click(screen.getByTitle("Notifications"));

    expect(screen.getByRole("img", { name: "Alpha" })).toBeInTheDocument();
  });

  it("dismisses one notification without clearing the rest", async () => {
    useNotificationStore.getState().addNotification({
      id: "live-1",
      platform: "twitch",
      channelId: "100",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      title: "Alpha stream",
      createdAt: Date.now(),
    });
    useNotificationStore.getState().addNotification({
      id: "live-2",
      platform: "kick",
      channelId: "200",
      channelName: "bravo",
      channelDisplayName: "Bravo",
      title: "Bravo stream",
      createdAt: Date.now(),
    });

    renderWithProviders(<NotificationsDropdown />);
    await userEvent.click(screen.getByTitle("Notifications"));
    await userEvent.click(screen.getAllByTitle("Dismiss")[0]);

    expect(screen.queryByText("Bravo stream")).not.toBeInTheDocument();
    expect(screen.getByText("Alpha stream")).toBeInTheDocument();
    expect(useNotificationStore.getState().notifications.map((item) => item.id)).toEqual([
      "live-1",
    ]);
  });

  it("clears all persisted notifications from the dropdown", async () => {
    useNotificationStore.getState().addNotification({
      id: "live-1",
      platform: "twitch",
      channelId: "100",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      title: "Alpha stream",
      createdAt: Date.now(),
    });

    renderWithProviders(<NotificationsDropdown />);
    await userEvent.click(screen.getByTitle("Notifications"));
    await userEvent.click(screen.getByText("Clear all notifications"));

    expect(screen.getByText("No new notifications")).toBeInTheDocument();
    expect(useNotificationStore.getState().notifications).toEqual([]);
  });

  it("marks all notifications read so the badge count disappears without clearing history", async () => {
    useNotificationStore.getState().addNotification({
      id: "live-1",
      platform: "twitch",
      channelId: "100",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      title: "Alpha stream",
      createdAt: Date.now(),
    });
    useNotificationStore.getState().addNotification({
      id: "live-2",
      platform: "kick",
      channelId: "200",
      channelName: "bravo",
      channelDisplayName: "Bravo",
      title: "Bravo stream",
      createdAt: Date.now(),
    });

    renderWithProviders(<NotificationsDropdown />);
    expect(screen.getByTitle("Notifications")).toHaveTextContent("2");

    await userEvent.click(screen.getByTitle("Notifications"));
    await userEvent.click(screen.getByText("Mark all read"));

    expect(screen.getByTitle("Notifications")).not.toHaveTextContent("2");
    expect(screen.getByText("Alpha stream")).toBeInTheDocument();
    expect(screen.getByText("Bravo stream")).toBeInTheDocument();
  });

  it("opens the matching stream page when clicking a notification without removing history", async () => {
    useNotificationStore.getState().addNotification({
      id: "live-1",
      platform: "twitch",
      channelId: "100",
      channelName: "alpha",
      channelDisplayName: "Alpha",
      title: "Variety stream",
      createdAt: Date.now(),
    });

    renderWithProviders(<NotificationsDropdown />);
    await userEvent.click(screen.getByTitle("Notifications"));
    await userEvent.click(screen.getByText("Variety stream"));

    expect(mockNavigate).toHaveBeenCalledWith({
      to: "/stream/$platform/$channel",
      params: { platform: "twitch", channel: "alpha" },
    });
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]?.id).toBe("live-1");
  });
});
