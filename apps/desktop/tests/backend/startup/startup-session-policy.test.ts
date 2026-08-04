import { describe, expect, it, vi } from "vitest";

import { beginStartupSession } from "@/backend/startup/startup-session-policy";

describe("beginStartupSession", () => {
  it("starts a new marked session without warning after a clean shutdown", () => {
    const wasCleanShutdown = vi.fn(() => true);
    const markSessionStarted = vi.fn();
    const warn = vi.fn();

    beginStartupSession({
      wasCleanShutdown,
      markSessionStarted,
      logger: { warn },
    });

    expect(wasCleanShutdown).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(markSessionStarted).toHaveBeenCalledOnce();
  });

  it("preserves cache and starts a new marked session after an unclean shutdown", () => {
    const wasCleanShutdown = vi.fn(() => false);
    const markSessionStarted = vi.fn();
    const warn = vi.fn();

    beginStartupSession({
      wasCleanShutdown,
      markSessionStarted,
      logger: { warn },
    });

    expect(wasCleanShutdown).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      "Main:Startup",
      "Previous session ended uncleanly; preserving Chromium cache"
    );
    expect(markSessionStarted).toHaveBeenCalledOnce();
  });
});
