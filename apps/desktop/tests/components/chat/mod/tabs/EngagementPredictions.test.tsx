import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/store/auth-store";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  }),
}));

vi.mock("@/backend/services/mod-log-writer", () => ({
  modLogWriter: {
    record: vi.fn(),
  },
}));

const getPredictionsMock = vi.fn();
vi.mock("@/backend/api/platforms/twitch/twitch-helix-predictions", async () => {
  const actual = await vi.importActual<
    typeof import("@/backend/api/platforms/twitch/twitch-helix-predictions")
  >("@/backend/api/platforms/twitch/twitch-helix-predictions");
  return {
    ...actual,
    getPredictions: (args: unknown) => getPredictionsMock(args),
  };
});

import { EngagementPredictions } from "@/components/chat/mod/tabs/EngagementPredictions";

const CHANNEL_ID = "111";

beforeEach(() => {
  getPredictionsMock.mockReset();
  useAuthStore.setState({
    twitchUser: {
      id: CHANNEL_ID,
      login: "broadcaster",
      displayName: "Broadcaster",
      profileImageUrl: "",
      createdAt: "",
      broadcasterType: "",
    } as any,
  });
  (globalThis.window as unknown as { electronAPI: unknown }).electronAPI = {
    auth: {
      getToken: vi.fn().mockResolvedValue({ accessToken: "tok" }),
    },
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("EngagementPredictions", () => {
  it("renders the create form when there is no active prediction", async () => {
    getPredictionsMock.mockResolvedValue({ ok: true, payload: { data: [] } });
    render(<EngagementPredictions channelId={CHANNEL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("prediction-create-form")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Prediction title")).toBeInTheDocument();
    expect(screen.getByLabelText("Outcome 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Outcome 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Create$/ })).toBeInTheDocument();
  });

  it("renders the live state when prediction.status=ACTIVE (Lock / Cancel buttons present)", async () => {
    getPredictionsMock.mockResolvedValue({
      ok: true,
      payload: {
        data: [
          {
            id: "p1",
            broadcaster_id: CHANNEL_ID,
            title: "Will we win?",
            winning_outcome_id: null,
            outcomes: [
              { id: "o1", title: "Yes", users: 5, channel_points: 1000, color: "BLUE" },
              { id: "o2", title: "No", users: 3, channel_points: 500, color: "PINK" },
            ],
            prediction_window: 120,
            status: "ACTIVE",
            created_at: "2026-05-18T00:00:00Z",
            ended_at: null,
            locked_at: null,
          },
        ],
      },
    });
    render(<EngagementPredictions channelId={CHANNEL_ID} />);
    await waitFor(() => {
      expect(screen.getByText("Will we win?")).toBeInTheDocument();
    });
    expect(screen.getByTestId("prediction-status")).toHaveTextContent("ACTIVE");
    expect(screen.getByRole("button", { name: /^Lock$/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toBeInTheDocument();
    expect(screen.getByText(/Yes/)).toBeInTheDocument();
    expect(screen.getByText(/No/)).toBeInTheDocument();
  });

  it("renders per-outcome 'Choose winner' buttons when prediction.status=LOCKED", async () => {
    getPredictionsMock.mockResolvedValue({
      ok: true,
      payload: {
        data: [
          {
            id: "p1",
            broadcaster_id: CHANNEL_ID,
            title: "Pick one",
            winning_outcome_id: null,
            outcomes: [
              { id: "o1", title: "Yes", users: 5, channel_points: 1000, color: "BLUE" },
              { id: "o2", title: "No", users: 3, channel_points: 500, color: "PINK" },
            ],
            prediction_window: 120,
            status: "LOCKED",
            created_at: "2026-05-18T00:00:00Z",
            ended_at: null,
            locked_at: "2026-05-18T00:02:00Z",
          },
        ],
      },
    });
    render(<EngagementPredictions channelId={CHANNEL_ID} />);
    await waitFor(() => {
      expect(screen.getByTestId("prediction-status")).toHaveTextContent("LOCKED");
    });
    const winnerButtons = screen.getAllByRole("button", { name: /^Choose winner$/ });
    expect(winnerButtons).toHaveLength(2);
    // Lock button gone (status !== ACTIVE), Cancel still present.
    expect(screen.queryByRole("button", { name: /^Lock$/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Cancel$/ })).toBeInTheDocument();
  });
});
