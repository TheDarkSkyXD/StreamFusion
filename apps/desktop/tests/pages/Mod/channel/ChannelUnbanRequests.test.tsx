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

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import { ChannelUnbanRequests } from "@/pages/Mod/channel/ChannelUnbanRequests";
import { toast } from "sonner";

const executeMock = vi.fn();
const SAMPLE_REQUEST = {
  id: "ur-1",
  broadcaster_id: "222",
  broadcaster_login: "b",
  broadcaster_name: "B",
  moderator_id: null,
  moderator_login: null,
  moderator_name: null,
  user_id: "u1",
  user_login: "viewer",
  user_name: "Viewer",
  text: "sorry, please unban",
  status: "pending",
  created_at: "2026-05-18T00:00:00Z",
  resolved_at: null,
  resolution_text: null,
};

// Guards: unban-request filters and approve/deny decisions cross typed Twitch IPC without credentials.
// Guards: empty and error responses remain visible and distinct.
describe("ChannelUnbanRequests", () => {
  beforeEach(() => {
    authState.twitchUser = { id: "111", login: "me" };
    const api = installElectronAPIMock();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ ok: true, data: { data: [], pagination: {} } });
    api.twitch.execute = executeMock;
    vi.mocked(toast.success).mockClear();
    vi.mocked(toast.error).mockClear();
  });

  it("renders pending unban requests", async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: { data: [SAMPLE_REQUEST], pagination: {} },
    });
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId("unban-request-row-ur-1")).toBeInTheDocument()
    );
    expect(screen.getByText("sorry, please unban")).toBeInTheDocument();
    expect(screen.getByText("Viewer")).toBeInTheDocument();
  });

  it("renders empty state when no requests exist", async () => {
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByText(/no pending unban requests/i)).toBeInTheDocument()
    );
  });

  it("approves with the trimmed resolution text", async () => {
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-unban-requests"
        ? { ok: true, data: { data: [SAMPLE_REQUEST], pagination: {} } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await screen.findByTestId("unban-request-row-ur-1");
    fireEvent.click(screen.getByTestId("unban-approve-button-ur-1"));
    fireEvent.change(await screen.findByLabelText(/resolution text/i), {
      target: { value: " all good " },
    });
    fireEvent.click(screen.getByTestId("unban-confirm-approved-ur-1"));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: "resolve-unban-request",
        broadcasterId: "222",
        moderatorId: "111",
        unbanRequestId: "ur-1",
        status: "approved",
        resolutionText: "all good",
      })
    );
    expect(screen.queryByTestId("unban-request-row-ur-1")).not.toBeInTheDocument();
  });

  it("denies without synthesizing empty resolution text", async () => {
    executeMock.mockImplementation(async (command) =>
      command.operation === "get-unban-requests"
        ? { ok: true, data: { data: [SAMPLE_REQUEST], pagination: {} } }
        : { ok: true, data: null }
    );
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await screen.findByTestId("unban-request-row-ur-1");
    fireEvent.click(screen.getByTestId("unban-deny-button-ur-1"));
    fireEvent.click(screen.getByTestId("unban-confirm-denied-ur-1"));

    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith({
        operation: "resolve-unban-request",
        broadcasterId: "222",
        moderatorId: "111",
        unbanRequestId: "ur-1",
        status: "denied",
        resolutionText: undefined,
      })
    );
  });

  it("requests the selected status filter", async () => {
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "get-unban-requests", status: "pending" })
      )
    );
    fireEvent.change(screen.getByTestId("unban-requests-status-filter"), {
      target: { value: "approved" },
    });
    await waitFor(() =>
      expect(executeMock).toHaveBeenCalledWith(
        expect.objectContaining({ operation: "get-unban-requests", status: "approved" })
      )
    );
  });

  it("surfaces an error when loading fails", async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: "unauthorized", message: "no access" },
    });
    renderWithProviders(<ChannelUnbanRequests broadcasterId="222" />);
    await waitFor(() =>
      expect(screen.getByTestId("channel-unban-requests-error")).toBeInTheDocument()
    );
  });
});
