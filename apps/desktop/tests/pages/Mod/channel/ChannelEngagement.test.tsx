import { beforeEach, describe, expect, it, vi } from "vitest";

import { installElectronAPIMock, renderWithProviders, screen, waitFor } from "../../../test-utils";

vi.mock("@/hooks/useInterval", () => ({ useInterval: vi.fn() }));

import { ChannelEngagement } from "@/pages/Mod/channel/ChannelEngagement";

const executeMock = vi.fn();
const prediction = (status: "ACTIVE" | "LOCKED" = "ACTIVE") => ({
  id: "p1",
  title: status === "LOCKED" ? "Locked pred" : "Who wins?",
  status,
  outcomes: [
    { id: "o1", title: "Team A", channel_points: 5000 },
    { id: "o2", title: "Team B", channel_points: 3000 },
  ],
});
const poll = {
  id: "poll1",
  title: "Favorite map?",
  status: "ACTIVE",
  choices: [
    { id: "c1", title: "Dust II", votes: 1500 },
    { id: "c2", title: "Mirage", votes: 800 },
  ],
};

// Guards: active poll/prediction reads use parallel typed Twitch IPC commands.
// Guards: loading, empty, ACTIVE, and LOCKED presentation states remain distinct.
describe("ChannelEngagement", () => {
  beforeEach(() => {
    const api = installElectronAPIMock();
    executeMock.mockReset();
    executeMock.mockResolvedValue({ ok: true, data: { data: [] } });
    api.twitch.execute = executeMock;
  });

  it("shows the empty state when there is no active engagement", async () => {
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(await screen.findByTestId("channel-engagement-empty")).toBeInTheDocument();
  });

  it("renders an active prediction", async () => {
    executeMock.mockImplementation(async (command) => ({
      ok: true,
      data: { data: command.operation === "get-predictions" ? [prediction()] : [] },
    }));
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(await screen.findByTestId("channel-engagement-prediction")).toBeInTheDocument();
    expect(screen.getByText("Who wins?")).toBeInTheDocument();
    expect(screen.getByText(/Team A/)).toBeInTheDocument();
  });

  it("renders an active poll", async () => {
    executeMock.mockImplementation(async (command) => ({
      ok: true,
      data: { data: command.operation === "get-polls" ? [poll] : [] },
    }));
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(await screen.findByTestId("channel-engagement-poll")).toBeInTheDocument();
    expect(screen.getByText("Favorite map?")).toBeInTheDocument();
    expect(screen.getByText(/Dust II/)).toBeInTheDocument();
  });

  it("shows loading while IPC reads are pending", () => {
    executeMock.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("renders a locked prediction", async () => {
    executeMock.mockImplementation(async (command) => ({
      ok: true,
      data: { data: command.operation === "get-predictions" ? [prediction("LOCKED")] : [] },
    }));
    renderWithProviders(<ChannelEngagement broadcasterId="123" />);
    expect(await screen.findByTestId("channel-engagement-prediction")).toBeInTheDocument();
    expect(screen.getByText("Locked pred")).toBeInTheDocument();
  });

  it("does not request engagement without a broadcaster", async () => {
    renderWithProviders(<ChannelEngagement broadcasterId="" />);
    await waitFor(() => expect(executeMock).not.toHaveBeenCalled());
  });
});
