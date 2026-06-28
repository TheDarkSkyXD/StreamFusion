import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchKickWebApiGetMock = vi.hoisted(() => vi.fn());
const loggerMock = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("@/backend/api/platforms/kick/kick-send-window", () => ({
  fetchKickWebApiGet: fetchKickWebApiGetMock,
}));

vi.mock("@/backend/logging/logger", () => ({
  logger: loggerMock,
}));

import { fetchKickUserSubscriptions } from "@/backend/services/emotes/kick-user-subscriptions-service";

beforeEach(() => {
  fetchKickWebApiGetMock.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
});

// Guards: Kick subscribed-channel emotes must fetch the web-only subscriptions
// endpoint through the Kick web session and pass null, not throw, on failures.
describe("fetchKickUserSubscriptions", () => {
  it("parses the subscriptions payload from the Kick web-session request", async () => {
    fetchKickWebApiGetMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: JSON.stringify({ data: [{ channel: { slug: "subbed" } }] }),
    });

    const result = await fetchKickUserSubscriptions();

    expect(fetchKickWebApiGetMock).toHaveBeenCalledWith("/api/v2/user/subscriptions");
    expect(result).toEqual({ data: [{ channel: { slug: "subbed" } }] });
  });

  it("returns null when the Kick web-session request is unavailable", async () => {
    fetchKickWebApiGetMock.mockResolvedValue({
      ok: false,
      kind: "auth-expired",
      status: 401,
      body: "{}",
      message: "expired",
    });

    const result = await fetchKickUserSubscriptions();

    expect(result).toBeNull();
    expect(loggerMock.info).toHaveBeenCalledOnce();
  });

  it("returns null when Kick returns non-JSON", async () => {
    fetchKickWebApiGetMock.mockResolvedValue({
      ok: true,
      status: 200,
      body: "not-json",
    });

    const result = await fetchKickUserSubscriptions();

    expect(result).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledOnce();
  });
});
