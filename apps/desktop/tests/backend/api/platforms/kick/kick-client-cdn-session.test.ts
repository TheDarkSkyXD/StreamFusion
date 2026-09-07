import { beforeEach, describe, expect, it, vi } from "vitest";

const { closeAllConnections, fromPartition, setProxy } = vi.hoisted(() => ({
  closeAllConnections: vi.fn(async () => {}),
  fromPartition: vi.fn(),
  setProxy: vi.fn(async () => {}),
}));

vi.mock("electron", () => ({
  session: { fromPartition },
}));

vi.mock("@backend/services/third-party-cookie-stripper", () => ({
  purgeStoredThirdPartyCookies: vi.fn(async () => {}),
  registerThirdPartyCookieStripper: vi.fn(),
}));

// Guards: a cold burst of image requests must configure and reconnect the shared CDN partition once; repeated closeAllConnections calls abort unrelated in-flight images.
// Guards: a failed CDN partition setup must clear the single-flight latch so a later image can recover.
describe("Kick CDN session initialization", () => {
  beforeEach(() => {
    vi.resetModules();
    closeAllConnections.mockClear();
    fromPartition.mockReset();
    setProxy.mockClear();
    fromPartition.mockReturnValue({ closeAllConnections, setProxy });
  });

  it("shares one initialization across concurrent image requests", async () => {
    const { kickTransport } = await import("@backend/api/platforms/kick/kick-transport");
    const getCdnSession = (
      kickTransport as unknown as {
        getCdnSession: () => Promise<unknown>;
      }
    ).getCdnSession.bind(kickTransport);

    const sessions = await Promise.all(Array.from({ length: 50 }, () => getCdnSession()));

    expect(new Set(sessions).size).toBe(1);
    expect(fromPartition).toHaveBeenCalledTimes(1);
    expect(setProxy).toHaveBeenCalledOnce();
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });

  it("allows a later initialization attempt after setup fails", async () => {
    setProxy.mockRejectedValueOnce(new Error("proxy setup failed"));
    const { kickTransport } = await import("@backend/api/platforms/kick/kick-transport");
    const getCdnSession = (
      kickTransport as unknown as {
        getCdnSession: () => Promise<unknown>;
      }
    ).getCdnSession.bind(kickTransport);

    await expect(getCdnSession()).rejects.toThrow("proxy setup failed");
    await expect(getCdnSession()).resolves.toBeDefined();

    expect(fromPartition).toHaveBeenCalledTimes(2);
    expect(setProxy).toHaveBeenCalledTimes(2);
    expect(closeAllConnections).toHaveBeenCalledOnce();
  });
});
