import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/store/auth-store";
import { installElectronAPIMock } from "../../../../test-utils";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("@backend/services/mod-log-writer", () => ({
  modLogWriter: {
    record: vi.fn(),
  },
}));

const executeMock = vi.fn();

import { EngagementPolls } from "@/features/chat/components/chat/mod/tabs/EngagementPolls";

const CHANNEL_ID = "111";

beforeEach(() => {
  executeMock.mockReset();
  useAuthStore.setState({
    twitchUser: {
      id: CHANNEL_ID,
      login: "broadcaster",
      displayName: "Broadcaster",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    },
  });
  installElectronAPIMock().twitch.execute = executeMock;
});

afterEach(() => {
  vi.useRealTimers();
});

// Guards: poll create/live/archive presentation reads through typed Twitch IPC.
describe("EngagementPolls", () => {
  it("renders the create form when there is no active poll", async () => {
    executeMock.mockResolvedValue({ ok: true, data: { data: [] } });
    render(<EngagementPolls channelId={CHANNEL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("poll-create-form")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Poll title")).toBeInTheDocument();
    expect(screen.getByLabelText("Choice 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Choice 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create$/ })).toBeInTheDocument();
  });

  it("renders the live state with Terminate when poll.status=ACTIVE", async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: "poll1",
            broadcaster_id: CHANNEL_ID,
            title: "Pick one",
            choices: [
              { id: "c1", title: "A", votes: 4, channel_points_votes: 0, bits_votes: 0 },
              { id: "c2", title: "B", votes: 6, channel_points_votes: 0, bits_votes: 0 },
            ],
            bits_voting_enabled: false,
            bits_per_vote: 0,
            channel_points_voting_enabled: false,
            channel_points_per_vote: 0,
            status: "ACTIVE",
            duration: 60,
            started_at: "2026-05-18T00:00:00Z",
            ended_at: null,
          },
        ],
      },
    });
    render(<EngagementPolls channelId={CHANNEL_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Pick one")).toBeInTheDocument();
    });
    expect(screen.getByTestId("poll-status")).toHaveTextContent("ACTIVE");
    expect(screen.getByRole("button", { name: /^Terminate$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Archive$/ })).toBeNull();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("renders Archive button when poll.status=TERMINATED", async () => {
    executeMock.mockResolvedValue({
      ok: true,
      data: {
        data: [
          {
            id: "poll1",
            broadcaster_id: CHANNEL_ID,
            title: "Pick one",
            choices: [
              { id: "c1", title: "A", votes: 4, channel_points_votes: 0, bits_votes: 0 },
              { id: "c2", title: "B", votes: 6, channel_points_votes: 0, bits_votes: 0 },
            ],
            bits_voting_enabled: false,
            bits_per_vote: 0,
            channel_points_voting_enabled: false,
            channel_points_per_vote: 0,
            status: "TERMINATED",
            duration: 60,
            started_at: "2026-05-18T00:00:00Z",
            ended_at: "2026-05-18T00:01:00Z",
          },
        ],
      },
    });
    render(<EngagementPolls channelId={CHANNEL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("poll-status")).toHaveTextContent("TERMINATED");
    });
    expect(screen.getByRole("button", { name: /^Archive$/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Terminate$/ })).toBeNull();
  });
});
