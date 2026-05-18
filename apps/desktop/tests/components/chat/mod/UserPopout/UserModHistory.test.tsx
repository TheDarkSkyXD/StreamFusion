import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useModLog", () => ({
  useModLog: vi.fn(),
}));

import { UserModHistory } from "@/components/chat/mod/UserPopout/UserModHistory";
import { useModLog } from "@/hooks/useModLog";

const mockedUseModLog = vi.mocked(useModLog);

beforeEach(() => {
  mockedUseModLog.mockReset();
});

describe("UserModHistory", () => {
  it("renders entries newest-first (relies on the underlying ORDER BY desc)", () => {
    mockedUseModLog.mockReturnValue({
      entries: [
        {
          id: 2,
          channelId: "c1",
          channelSlug: "streamer",
          action: "timeout",
          targetUserId: "u1",
          targetUsername: "alice",
          moderatorUserId: "m1",
          moderatorUsername: "modbob",
          durationSeconds: 600,
          reason: null,
          createdAt: Date.now() - 1000,
        },
        {
          id: 1,
          channelId: "c1",
          channelSlug: "streamer",
          action: "ban",
          targetUserId: "u1",
          targetUsername: "alice",
          moderatorUserId: "m1",
          moderatorUsername: "modcarol",
          durationSeconds: null,
          reason: null,
          createdAt: Date.now() - 5000,
        },
      ],
      loading: false,
    });
    render(
      <UserModHistory channelId="c1" targetUserId="u1" />,
    );
    const list = screen.getByTestId("user-mod-history-list");
    expect(list).toBeInTheDocument();
    const rows = list.querySelectorAll("li");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("timeout");
    expect(rows[1].textContent).toContain("ban");
    expect(screen.getByText(/modbob/)).toBeInTheDocument();
    expect(screen.getByText(/modcarol/)).toBeInTheDocument();
  });

  it("renders an empty-state when there are no entries", () => {
    mockedUseModLog.mockReturnValue({ entries: [], loading: false });
    render(<UserModHistory channelId="c1" targetUserId="u1" />);
    expect(screen.getByTestId("user-mod-history-empty")).toBeInTheDocument();
    expect(screen.getByText(/No mod history/)).toBeInTheDocument();
  });

  it("shows a loading placeholder while the hook reports loading=true", () => {
    mockedUseModLog.mockReturnValue({ entries: [], loading: true });
    render(<UserModHistory channelId="c1" targetUserId="u1" />);
    expect(screen.getByTestId("user-mod-history-loading")).toBeInTheDocument();
  });
});
