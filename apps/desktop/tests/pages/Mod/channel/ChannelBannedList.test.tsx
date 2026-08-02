import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  fireEvent,
  installElectronAPIMock,
  renderWithProviders,
  screen,
  waitFor,
} from "../../../test-utils";

const authState = vi.hoisted(() => ({
  twitchUser: { id: "111", login: "me" } as { id: string; login: string } | null,
}));

vi.mock("@/store/auth-store", () => {
  const useStore = (selector: (state: typeof authState) => unknown) => selector(authState);
  return { useAuthStore: useStore };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import { ChannelBannedList } from "@/pages/Mod/channel/ChannelBannedList";
import { toast } from "sonner";

const executeMock = vi.fn();
const BANNED_USER = {
  user_id: "u1",
  user_login: "badactor",
  user_name: "BadActor",
  expires_at: "",
  created_at: "2024-01-01T00:00:00Z",
  reason: "spam",
  moderator_id: "m1",
  moderator_login: "mod1",
  moderator_name: "Mod1",
};

// Guards: banned-user reads and unban writes use typed Twitch IPC without renderer credentials.
// Guards: Kick informational, empty, unauthorized, not-found, and success states remain distinct.
describe("ChannelBannedList", () => {
  beforeEach(() => {
    authState.twitchUser = { id: "111", login: "me" };
    const api = installElectronAPIMock();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ ok: true, data: { data: [] } });
    api.twitch.execute = executeMock;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("renders the Kick information without a Twitch request", () => {
    renderWithProviders(<ChannelBannedList platform="kick" />);
    expect(screen.getByTestId("channel-banned-list-kick")).toBeInTheDocument();
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("renders banned Twitch users", async () => {
    executeMock.mockResolvedValue({ ok: true, data: { data: [BANNED_USER] } });
    renderWithProviders(<ChannelBannedList platform="twitch" broadcasterId="222" />);
    expect(await screen.findByTestId("banned-row-u1")).toBeInTheDocument();
    expect(screen.getByText("badactor")).toBeInTheDocument();
  });

  it("surfaces an unauthorized response", async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "Sign in again or grant the required scope" },
    });
    renderWithProviders(<ChannelBannedList platform="twitch" broadcasterId="222" />);
    expect(await screen.findByTestId("channel-banned-list-error")).toHaveTextContent(/scope|sign-in/i);
  });

  it("surfaces a not-found response", async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: "unavailable", message: "Channel not found" },
    });
    renderWithProviders(<ChannelBannedList platform="twitch" broadcasterId="222" />);
    expect(await screen.findByTestId("channel-banned-list-error")).toHaveTextContent(/not found/i);
  });

  it("renders the empty state", async () => {
    renderWithProviders(<ChannelBannedList platform="twitch" broadcasterId="222" />);
    expect(await screen.findByText(/no banned users/i)).toBeInTheDocument();
  });

  it("sends the selected user and moderator in the unban command", async () => {
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-banned-users"
        ? { ok: true, data: { data: [BANNED_USER] } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelBannedList platform="twitch" broadcasterId="222" />);
    await screen.findByTestId("unban-button-u1");
    fireEvent.click(screen.getByTestId("unban-button-u1"));
    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: "unban-user",
        broadcasterId: "222",
        moderatorId: "111",
        userId: "u1",
      })
    );
  });

  it("drops the row and toasts after an unban succeeds", async () => {
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-banned-users"
        ? { ok: true, data: { data: [BANNED_USER] } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelBannedList platform="twitch" broadcasterId="222" />);
    await screen.findByTestId("banned-row-u1");
    fireEvent.click(screen.getByTestId("unban-button-u1"));
    await waitFor(() => expect(screen.queryByTestId("banned-row-u1")).not.toBeInTheDocument());
    expect(toast.success).toHaveBeenCalled();
  });
});
