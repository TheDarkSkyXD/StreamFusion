import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/backend/logging/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("electron", () => ({
  net: { fetch: vi.fn() },
}));

import { getTwitchChannelHistory } from "@/backend/api/platforms/twitch/endpoints/chat-endpoints";

describe("getTwitchChannelHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null for empty login (short-circuits before network)", async () => {
    const result = await getTwitchChannelHistory("");
    expect(result).toBeNull();
  });

  it("returns null on network error (require('electron') fails gracefully)", async () => {
    const result = await getTwitchChannelHistory("broken");
    expect(result).toBeNull();
  });
});
