import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ModLogEntry } from "@/backend/services/database-service";
import type { ModLogAction } from "@/backend/services/mod-log-writer";

// Mock useModLog so the tab gets deterministic data without touching SQLite.
let lastOpts: any = null;
const useModLogMock = vi.fn();
vi.mock("@/hooks/useModLog", () => ({
  useModLog: (opts: any) => {
    lastOpts = opts;
    return useModLogMock(opts);
  },
}));

const openUserPopoutMock = vi.fn();
vi.mock("@/components/chat/mod/UserPopout/UserPopoutProvider", () => ({
  useOpenUserPopout: () => openUserPopoutMock,
}));

import { ModLogTab } from "@/components/chat/mod/tabs/ModLogTab";

const CHANNEL_ID = "ch-1";

function makeEntry(
  i: number,
  overrides: Partial<ModLogEntry> = {},
): ModLogEntry {
  return {
    id: i,
    channelId: CHANNEL_ID,
    channelSlug: "test-channel",
    action: "ban" as ModLogAction,
    targetUserId: `target-${i}`,
    targetUsername: `target${i}`,
    moderatorUserId: `mod-${i}`,
    moderatorUsername: `mod${i}`,
    durationSeconds: null,
    reason: null,
    createdAt: Date.now() - i * 1000,
    ...overrides,
  };
}

beforeEach(() => {
  useModLogMock.mockReset();
  openUserPopoutMock.mockReset();
  lastOpts = null;
});

afterEach(() => {
  // nothing else
});

describe("ModLogTab", () => {
  it("renders entries returned by useModLog on mount with default limit 50", () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry(i + 1));
    useModLogMock.mockReturnValue({ entries, loading: false });
    render(<ModLogTab channelId={CHANNEL_ID} />);
    expect(screen.getAllByTestId("modlog-row")).toHaveLength(50);
    expect(lastOpts.limit).toBe(50);
  });

  it("filters by action when the action select changes", () => {
    useModLogMock.mockReturnValue({ entries: [], loading: false });
    render(<ModLogTab channelId={CHANNEL_ID} />);
    fireEvent.change(screen.getByTestId("modlog-action-filter"), {
      target: { value: "ban" },
    });
    expect(lastOpts.action).toBe("ban");
  });

  it("filters by moderator username when the input changes", () => {
    useModLogMock.mockReturnValue({ entries: [], loading: false });
    render(<ModLogTab channelId={CHANNEL_ID} />);
    fireEvent.change(screen.getByTestId("modlog-moderator-filter"), {
      target: { value: "alice" },
    });
    expect(lastOpts.moderatorUsername).toBe("alice");
  });

  it("clicking a target username opens the user popout", () => {
    useModLogMock.mockReturnValue({
      entries: [makeEntry(1, { targetUsername: "spammer", targetUserId: "u9" })],
      loading: false,
    });
    render(<ModLogTab channelId={CHANNEL_ID} />);
    fireEvent.click(screen.getByTestId("modlog-target-username"));
    expect(openUserPopoutMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u9",
        username: "spammer",
      }),
    );
  });

  it("Load More bumps the limit by 50", () => {
    // First render: 50 entries returned → button should show.
    const fullPage = Array.from({ length: 50 }, (_, i) => makeEntry(i + 1));
    useModLogMock.mockReturnValue({ entries: fullPage, loading: false });
    render(<ModLogTab channelId={CHANNEL_ID} />);
    fireEvent.click(screen.getByTestId("modlog-load-more"));
    expect(lastOpts.limit).toBe(100);
  });
});
