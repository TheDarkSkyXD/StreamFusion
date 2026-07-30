import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useModLog", () => ({
  useModLog: vi.fn(),
}));

import { UserModHistory } from "@/components/chat/mod/UserPopout/UserModHistory";
import { useModLog } from "@/hooks/useModLog";
import type { ModLogEntry } from "@/shared/mod-log-types";

const mockedUseModLog = vi.mocked(useModLog);
const retry = vi.fn();

function entry(overrides: Partial<ModLogEntry>): ModLogEntry {
  const occurredAt = overrides.occurredAt ?? Date.now() - 1_000;
  return {
    id: 1,
    platform: "twitch",
    channelId: "c1",
    channelSlug: "streamer",
    action: "timeout",
    targetUserId: "u1",
    targetUsername: "alice",
    moderatorUserId: "m1",
    moderatorUsername: "modbob",
    durationSeconds: 600,
    reason: null,
    provenance: "twitch-eventsub",
    providerEventId: "event-1",
    occurredAt,
    observedAt: occurredAt,
    createdAt: occurredAt,
    ...overrides,
  };
}

function renderHistory(platform: "twitch" | "kick" = "twitch") {
  return render(
    <UserModHistory platform={platform} channelId="c1" channelSlug="streamer" targetUserId="u1" />
  );
}

beforeEach(() => {
  mockedUseModLog.mockReset();
  retry.mockReset();
});

// Guards: every supported moderation record exposes its reason when the platform supplied one.
// Guards: failed reads use the exact compact “Couldn’t load · Retry” recovery action.
// Guards: clock skew never produces a negative relative timestamp.
describe("UserModHistory", () => {
  it("queries Kick dialog history with the canonical broadcaster id and its matching slug", () => {
    mockedUseModLog.mockReturnValue({
      result: { state: "verified-empty", entries: [], coverage: "complete" },
      entries: [],
      loading: false,
      retry,
    });

    render(
      <UserModHistory platform="kick" channelId="987654" channelSlug="Xqc" targetUserId="u1" />
    );

    expect(mockedUseModLog).toHaveBeenCalledWith(
      expect.objectContaining({
        platform: "kick",
        channelId: "987654",
        channelSlug: "Xqc",
      })
    );
  });

  it("renders the platform history entries returned newest-first", () => {
    const entries = [
      entry({ id: 2, reason: "Repeated spoilers" }),
      entry({
        id: 1,
        action: "ban",
        moderatorUsername: "modcarol",
        durationSeconds: null,
        occurredAt: Date.now() - 5_000,
      }),
    ];
    mockedUseModLog.mockReturnValue({
      result: { state: "ready", entries, coverage: "complete" },
      entries,
      loading: false,
      retry,
    });

    renderHistory();

    const rows = screen.getByTestId("user-mod-history-list").querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("timeout");
    expect(rows[1].textContent).toContain("ban");
    expect(screen.getByText(/modbob/)).toBeInTheDocument();
    expect(screen.getByText(/modcarol/)).toBeInTheDocument();
    expect(screen.getByText("Repeated spoilers")).toBeInTheDocument();
  });

  it.each([
    "twitch",
    "kick",
  ] as const)("renders a verified empty %s state without implying complete platform archives", (platform) => {
    mockedUseModLog.mockReturnValue({
      result: { state: "verified-empty", entries: [], coverage: "complete" },
      entries: [],
      loading: false,
      retry,
    });

    renderHistory(platform);

    expect(screen.getByTestId("user-mod-history-empty")).toHaveTextContent(
      "No moderation actions available"
    );
  });

  it.each([
    "twitch",
    "kick",
  ] as const)("labels partial %s observation-window history", (platform) => {
    const entries = [entry({})];
    mockedUseModLog.mockReturnValue({
      result: {
        state: "partial",
        entries,
        coverage: "partial",
        reason: "observation-window",
      },
      entries,
      loading: false,
      retry,
    });

    renderHistory(platform);

    expect(screen.getByTestId("user-mod-history-partial")).toHaveTextContent(
      "Showing observed history only"
    );
    expect(screen.getByTestId("user-mod-history-list")).toBeInTheDocument();
  });

  it.each([
    "twitch",
    "kick",
  ] as const)("keeps %s query failures distinct and offers Retry", (platform) => {
    mockedUseModLog.mockReturnValue({
      result: {
        state: "error",
        entries: [],
        code: "query-failed",
        retryable: true,
      },
      entries: [],
      loading: false,
      retry,
    });

    renderHistory(platform);
    fireEvent.click(screen.getByRole("button", { name: "Couldn’t load · Retry" }));

    expect(screen.getByTestId("user-mod-history-error")).toHaveTextContent("Couldn’t load · Retry");
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("clamps future provider timestamps to zero seconds ago", () => {
    const entries = [entry({ occurredAt: Date.now() + 60_000 })];
    mockedUseModLog.mockReturnValue({
      result: { state: "ready", entries, coverage: "complete" },
      entries,
      loading: false,
      retry,
    });

    renderHistory();

    expect(screen.getByText("0s ago")).toBeInTheDocument();
    expect(screen.queryByText(/-\d+s ago/)).toBeNull();
  });

  it("shows a loading placeholder", () => {
    mockedUseModLog.mockReturnValue({
      result: { state: "loading", entries: [] },
      entries: [],
      loading: true,
      retry,
    });

    renderHistory();

    expect(screen.getByTestId("user-mod-history-loading")).toBeInTheDocument();
  });
});
