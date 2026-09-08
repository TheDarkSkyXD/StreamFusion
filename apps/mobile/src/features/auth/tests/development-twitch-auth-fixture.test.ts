import { afterEach, describe, expect, it, vi } from "vitest";

import { createDevelopmentTwitchAuthFixture } from "../adapters/twitch/development-twitch-auth-fixture";

const signal = {
  aborted: false,
  onCancel: () => () => undefined,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("development Twitch authentication fixture", () => {
  it("holds each request pending for at least 60 seconds of coordinator cadence", async () => {
    vi.stubGlobal("__DEV__", true);
    const gateway = createDevelopmentTwitchAuthFixture();

    const authorization = await gateway.request([], signal);
    expect(authorization.intervalSeconds).toBe(2);
    expect(await gateway.poll(authorization.deviceCode, signal)).toEqual({
      kind: "transient-failure",
    });

    for (let poll = 2; poll < 16; poll += 1) {
      expect(await gateway.poll(authorization.deviceCode, signal)).toEqual({
        kind: "pending",
      });
    }
    expect(await gateway.poll(authorization.deviceCode, signal)).toMatchObject({
      kind: "authorized",
    });

    const secondAuthorization = await gateway.request([], signal);
    expect(
      await gateway.poll(secondAuthorization.deviceCode, signal),
    ).toEqual({ kind: "transient-failure" });
    expect(await gateway.poll(secondAuthorization.deviceCode, signal)).toEqual({
      kind: "pending",
    });
  });

  it("cannot be created outside a development runtime", () => {
    vi.stubGlobal("__DEV__", false);

    expect(() => createDevelopmentTwitchAuthFixture()).toThrow(
      "The Twitch authentication fixture is development-only.",
    );
  });
});
