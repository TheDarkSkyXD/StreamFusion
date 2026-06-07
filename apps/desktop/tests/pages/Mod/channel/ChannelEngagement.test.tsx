import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock, renderWithProviders, screen, waitFor } from "../../../test-utils";

const mocks = vi.hoisted(() => ({
  getPredictions: vi.fn(),
  getPolls: vi.fn(),
  withTwitchHelixRetry: vi.fn(),
}));

vi.mock("@/backend/api/platforms/twitch/helix-retry", () => ({
  withTwitchHelixRetry: (_ctx: unknown, fn: unknown) =>
    mocks.withTwitchHelixRetry(_ctx, fn),
}));

vi.mock("@/backend/api/platforms/twitch/twitch-helix-predictions", () => ({
  getPredictions: mocks.getPredictions,
}));

vi.mock("@/backend/api/platforms/twitch/twitch-helix-polls", () => ({
  getPolls: mocks.getPolls,
}));

vi.mock("@/hooks/useInterval", () => ({
  useInterval: vi.fn(),
}));

import { ChannelEngagement } from "@/pages/Mod/channel/ChannelEngagement";

describe("ChannelEngagement", () => {
  let api: ReturnType<typeof installElectronAPIMock>;

  beforeEach(() => {
    api = installElectronAPIMock();
    api.auth.getValidTwitchToken = vi.fn(async () => "tok");
    // biome-ignore lint/suspicious/noExplicitAny: env stub.
    (import.meta as any).env = { VITE_TWITCH_CLIENT_ID: "cid" };

    mocks.withTwitchHelixRetry.mockImplementation(async (_ctx: unknown, fn: unknown) => {
      if (fn === mocks.getPredictions) {
        return { ok: false, payload: { data: [] } };
      }
      return { ok: false, payload: { data: [] } };
    });
  });

  it("shows the empty state when there is no active prediction or poll", async () => {
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    await waitFor(() => {
      expect(screen.getByTestId("channel-engagement-empty")).toBeInTheDocument();
    });
    expect(screen.getByText("No active prediction or poll.")).toBeInTheDocument();
  });

  it("renders an active prediction", async () => {
    mocks.withTwitchHelixRetry.mockImplementation(async (_ctx: unknown, fn: unknown) => {
      if (fn === mocks.getPredictions) {
        return {
          ok: true,
          payload: {
            data: [
              {
                id: "p1",
                title: "Who wins?",
                status: "ACTIVE",
                outcomes: [
                  { id: "o1", title: "Team A", channel_points: 5000 },
                  { id: "o2", title: "Team B", channel_points: 3000 },
                ],
              },
            ],
          },
        };
      }
      return { ok: false, payload: { data: [] } };
    });

    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    await waitFor(() => {
      expect(screen.getByTestId("channel-engagement-prediction")).toBeInTheDocument();
    });
    expect(screen.getByText("Who wins?")).toBeInTheDocument();
    expect(screen.getByText(/Team A/)).toBeInTheDocument();
    expect(screen.getByText(/Team B/)).toBeInTheDocument();
  });

  it("renders an active poll", async () => {
    mocks.withTwitchHelixRetry.mockImplementation(async (_ctx: unknown, fn: unknown) => {
      if (fn === mocks.getPolls) {
        return {
          ok: true,
          payload: {
            data: [
              {
                id: "poll1",
                title: "Favorite map?",
                status: "ACTIVE",
                choices: [
                  { id: "c1", title: "Dust II", votes: 1500 },
                  { id: "c2", title: "Mirage", votes: 800 },
                ],
              },
            ],
          },
        };
      }
      return { ok: false, payload: { data: [] } };
    });

    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    await waitFor(() => {
      expect(screen.getByTestId("channel-engagement-poll")).toBeInTheDocument();
    });
    expect(screen.getByText("Favorite map?")).toBeInTheDocument();
    expect(screen.getByText(/Dust II/)).toBeInTheDocument();
    expect(screen.getByText(/Mirage/)).toBeInTheDocument();
  });

  it("shows loading state initially before data arrives", () => {
    mocks.withTwitchHelixRetry.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders a LOCKED prediction (not just ACTIVE)", async () => {
    mocks.withTwitchHelixRetry.mockImplementation(async (_ctx: unknown, fn: unknown) => {
      if (fn === mocks.getPredictions) {
        return {
          ok: true,
          payload: {
            data: [
              {
                id: "p1",
                title: "Locked pred",
                status: "LOCKED",
                outcomes: [
                  { id: "o1", title: "Yes", channel_points: 100 },
                ],
              },
            ],
          },
        };
      }
      return { ok: false, payload: { data: [] } };
    });

    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    await waitFor(() => {
      expect(screen.getByTestId("channel-engagement-prediction")).toBeInTheDocument();
    });
    expect(screen.getByText("Locked pred")).toBeInTheDocument();
  });

  it("does not fetch when broadcasterId is empty", async () => {
    renderWithProviders(<ChannelEngagement broadcasterId="" />);
    await new Promise((r) => setTimeout(r, 50));
    expect(api.auth.getValidTwitchToken).not.toHaveBeenCalled();
  });
});
